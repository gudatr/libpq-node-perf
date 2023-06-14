"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresClient = exports.ClientConfig = void 0;
//Clear the queue using this value to free up used promises
const EMPTY_FUNCTION = (_client) => { };
class Postgres {
    constructor(config) {
        var _a, _b, _c;
        this.config = config;
        this._prepareIndex = 0;
        this.getPos = 0;
        this.putPos = 0;
        this.connectionStack = [];
        this.stackPosition = 0;
        this.escapeRegex = /\\|_|%/gi;
        this.escapeMatches = {};
        this.queue = new Array(config.queueSize);
        this._queueSize = (_a = config.queueSize) !== null && _a !== void 0 ? _a : 200000;
        this.escapeChar = (_b = config.escapeChar) !== null && _b !== void 0 ? _b : '\\';
        this.escapedApostrophe = this.escapeChar + "'";
        this.escapeRegex = new RegExp(this.escapeChar.replace(/\\/g, '\\\\') + "|_|%", "gi");
        this.escapeMatches = {
            [this.escapeChar]: this.escapeChar + this.escapeChar,
            "_": this.escapeChar + "_",
            "%": this.escapeChar + "%"
        };
        if (!config.socket) {
            this.connectionString = `postgresql://${config.user}:${(_c = config.password) !== null && _c !== void 0 ? _c : ''}@${config.host}:${config.port}/${config.database}`;
        }
        else {
            this.connectionString = `postgresql://${config.user}@/${config.database}?host=${config.socket}`;
        }
    }
    /**
     * @returns the total size of the internal query queue
     */
    queueSize() {
        return this.queueSize;
    }
    /**
     * @returns the size of the queue currently occupied by waiting queries
     */
    queueUsage() {
        let diff = this.putPos - this.getPos;
        if (this.getPos < this.putPos)
            return diff;
        return this._queueSize + diff;
    }
    /**
     * Initializes the pool with client instances and sets their search_path to the schema specified in the client config
     * Await this function to make sure your app doesn't query the pool before it is ready
     */
    async initialize() {
        for (let i = 0; i < this.config.threads; i++) {
            let client = this.connectionStack[i] = new PostgresClient(this.config.valuesOnly, this);
            client.connect(this.connectionString);
            await client.queryString(`SET search_path TO ${this.config.schema}`);
        }
        this.stackPosition = this.config.threads - 1;
    }
    /**
     * Grab a client from the pool or wait until one becomes available and the internal tick is called
     * @returns
     */
    connect() {
        return new Promise(async (resolve) => {
            if (++this.putPos >= this._queueSize)
                this.putPos = 0;
            this.queue[this.putPos] = resolve;
            this.tick();
        });
    }
    /**
     * Get a client from the pool, execute the query and return it afterwards (even if there is an error)
     * @param name
     * @param text
     * @param values
     * @returns
     */
    async query(name, text, values) {
        let client = await this.connect();
        try {
            return await client.query(name, text, values);
        }
        finally {
            this.release(client);
        }
    }
    /**
     * Query a string directly. Do not use it for transactions as it does pick the next available client for the query
     * @param query
     * @returns
     */
    async queryString(query) {
        let client = await this.connect();
        try {
            return await client.queryString(query);
        }
        finally {
            this.release(client);
        }
    }
    /**
     * Get a client from the pool, execute the query and return the affected row count
     * @param name
     * @param text
     * @param values
     * @returns
     */
    async queryCount(name, text, values) {
        let client = await this.connect();
        try {
            return await client.queryCount(name, text, values);
        }
        finally {
            this.release(client);
        }
    }
    /**
     * Query a string directly and return the affected row count
     * @param query
     * @returns
     */
    async queryStringCount(query) {
        let client = await this.connect();
        try {
            return await client.queryStringCount(query);
        }
        finally {
            this.release(client);
        }
    }
    /**
     * Release a client back into the pool for queries
     * @param client
     */
    release(client) {
        this.connectionStack[++this.stackPosition] = client;
        this.tick();
    }
    /**
     * Grab a waiting query from the queue and execute it on the next available client
     */
    tick() {
        while (this.stackPosition > -1 && this.getPos !== this.putPos) {
            if (++this.getPos >= this._queueSize)
                this.getPos = 0;
            let handler = this.queue[this.getPos];
            this.queue[this.getPos] = EMPTY_FUNCTION;
            handler(this.connectionStack[this.stackPosition--]);
        }
    }
    /**
     * This will get you a unique, smallest possible string on each call.
     * A helper function for creating prepared statements
     * @returns string
     */
    getPrepareIdentifier() {
        return (this._prepareIndex++).toString(36);
    }
    /**
    * Will transform the provided array into a string postgresql can recognize as a dynamic array.
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    transformArray(array) {
        return '{' + array + '}';
    }
    /**
    * Will transform the provided string array into a string postgresql can recognize as a dynamic array
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    transformStringArray(array) {
        for (let i = 0; i < array.length; i++) {
            array[i] = array[i].replace(/'/g, this.escapedApostrophe);
        }
        return "{'" + array.join("','") + "'}";
    }
    /**
     * If you want to run quries using LIKE you can pass user input through here to
     * escape characters that are considered for patterns if the value is a string
     * @param input
     * @returns string
     */
    escapeWildcards(input) {
        return input.replace(this.escapeRegex, (matched) => {
            return this.escapeMatches[matched];
        });
    }
}
exports.default = Postgres;
/**
    example config:
    {
        user: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        database: 'template1',
        schema: 'public',
        socket: undefined,
        password: undefined,
        threads: 10,
        queueSize: 65535,
        escapeChar: '\\',
        valuesOnly: false
    }
 */
class ClientConfig {
    constructor(user, host, port, database, schema, socket, password, threads = 10, queueSize = 65535, escapeChar = '\\', valuesOnly = false) {
        this.user = user;
        this.host = host;
        this.port = port;
        this.database = database;
        this.schema = schema;
        this.socket = socket;
        this.password = password;
        this.threads = threads;
        this.queueSize = queueSize;
        this.escapeChar = escapeChar;
        this.valuesOnly = valuesOnly;
    }
}
exports.ClientConfig = ClientConfig;
let Libpq = require("libpq");
let typeParsers = require('pg-types');
//Reduces the lookup time for the parser
let typesFlat = [];
for (let type in typeParsers.builtins) {
    let parser = typeParsers.getTypeParser(type, 'text');
    let parserId = typeParsers.builtins[type];
    typesFlat[parserId] = parser;
}
const types = typesFlat;
const NOTIFICATION = 'notification';
class PostgresClient extends Libpq {
    /**
     * Execute a statement, prepare it if it has not been prepared already.
     * @param queryName
     * @param text
     * @param values
     * @returns
     */
    query(queryName, text, values) {
        if (this.prepared[queryName]) {
            return new Promise((resolve, reject) => {
                this.executeStatement(queryName, values, reject, resolve);
            });
        }
        return new Promise((resolve, reject) => {
            this.prepareStatement(queryName, text, values.length, reject, () => {
                this.prepared[queryName] = true;
                this.executeStatement(queryName, values, reject, resolve);
            });
        });
    }
    /**
     * Query a string directly. Useful for starting transactions, etc.
     * @param query
     * @returns
     */
    queryString(query) {
        return new Promise((resolve, reject) => {
            this.internalQuery(query, reject, resolve);
        });
    }
    /**
     * Execute a statement, prepare it if it has not been prepared already and return affected row count
     * @param queryName
     * @param text
     * @param values
     * @returns affected row count
     */
    async queryCount(queryName, text, values) {
        this.count = true;
        return await this.query(queryName, text, values);
    }
    /**
     * Query a string directly and return the affected row count
     * @param query
     * @returns affected row count
     */
    async queryStringCount(query) {
        this.count = true;
        return await this.queryString(query);
    }
    /**
     * Release the client back into the pool
     */
    release() {
        this.parentPool.release(this);
    }
    constructor(valuesOnly = false, parentPool) {
        super();
        this.parentPool = parentPool;
        this.isReading = false;
        this.resolveCallback = (rows) => { };
        this.rejectCallback = (err) => { };
        this.error = undefined;
        this.fieldCount = 0;
        this.names = [];
        this.types = [];
        this.rows = [];
        this.count = false;
        this.prepared = {};
        this.parse = (valuesOnly ? this.parseArray : this.parseObject).bind(this);
        this.consumeFields = (valuesOnly ? this.consumeFieldsArray : this.consumeFieldsObject).bind(this);
        this.on('readable', this.readData.bind(this));
        this.on('newListener', (event) => {
            if (event !== NOTIFICATION)
                return;
            this.startReading();
        });
    }
    readValue(rowIndex, fieldIndex) {
        let rawValue = this.$getvalue(rowIndex, fieldIndex);
        if (rawValue === '' && this.$getisnull(rowIndex, fieldIndex))
            return null;
        let parser = this.types[fieldIndex];
        if (parser)
            return parser(rawValue);
        return rawValue;
    }
    parseObject(rowIndex) {
        let row = {};
        for (let fieldIndex = 0; fieldIndex < this.fieldCount; fieldIndex++) {
            row[this.names[fieldIndex]] = this.readValue(rowIndex, fieldIndex);
        }
        return row;
    }
    parseArray(rowIndex) {
        let row = new Array(this.fieldCount);
        for (let fieldIndex = 0; fieldIndex < this.fieldCount; fieldIndex++) {
            row[fieldIndex] = this.readValue(rowIndex, fieldIndex);
        }
        return row;
    }
    consumeFieldsObject() {
        this.fieldCount = this.$nfields();
        for (let x = 0; x < this.fieldCount; x++) {
            this.names[x] = this.$fname(x);
            this.types[x] = types[this.$ftype(x)];
        }
        let tupleCount = this.$ntuples();
        this.rows = new Array(tupleCount);
        for (let i = 0; i < tupleCount; i++) {
            this.rows[i] = this.parse(i);
        }
    }
    consumeFieldsArray() {
        this.fieldCount = this.$nfields();
        for (let x = 0; x < this.fieldCount; x++) {
            this.types[x] = types[this.$ftype(x)];
        }
        let tupleCount = this.$ntuples();
        this.rows = new Array(tupleCount);
        for (let i = 0; i < tupleCount; i++) {
            this.rows[i] = this.parse(i);
        }
    }
    /**
     * Attempts to connect using the provided connection string. Blocking.
     * @param connectionString
     * @param cb
     * @returns
     */
    connect(connectionString) {
        this.names = [];
        this.types = [];
        if (!this.$connectSync(connectionString))
            throw new Error(this.$getLastErrorMessage() || 'Unable to connect');
        if (!this.$setNonBlocking(1))
            throw new Error(this.$getLastErrorMessage() || 'Unable to set non blocking to true');
    }
    internalQuery(text, reject, resolve) {
        this.stopReading();
        if (!this.$sendQuery(text))
            return reject(new Error(this.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }
    /**
     * Prepares a statement, calls reject on fail, resolve on success
     * @param connectionString
     * @param cb
     * @returns
     */
    prepareStatement(statementName, text, nParams, reject, resolve) {
        this.stopReading();
        if (!this.$sendPrepare(statementName, text, nParams))
            return reject(new Error(this.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }
    /**
     * Executes a prepared statement, calls reject on fail, resolve on success
     * @param connectionString
     * @param cb
     * @returns
     */
    executeStatement(statementName, parameters, reject, resolve) {
        this.stopReading();
        if (!this.$sendQueryPrepared(statementName, parameters))
            return reject(new Error(this.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }
    waitForDrain() {
        let res = this.$flush();
        // res of 0 is success
        if (res === 0)
            return this.startReading();
        // res of -1 is failure
        if (res === -1)
            return this.rejectCallback(this.$getLastErrorMessage());
        // otherwise outgoing message didn't flush to socket, wait again
        this.$startWrite();
        this.once('writable', this.waitForDrain);
    }
    readError(message = undefined) {
        this.emit('error', new Error(message || this.$getLastErrorMessage()));
    }
    stopReading() {
        if (!this.isReading)
            return;
        this.isReading = false;
        this.$stopRead();
    }
    emitResult() {
        let status = this.$resultStatus();
        switch (status) {
            case 'PGRES_TUPLES_OK':
            case 'PGRES_COMMAND_OK':
            case 'PGRES_EMPTY_QUERY':
                if (this.count) {
                    this.count = false;
                    this.rows = +this.$cmdTuples();
                }
                else {
                    this.consumeFields();
                }
                break;
            case 'PGRES_FATAL_ERROR':
                this.error = new Error(this.$resultErrorMessage());
                break;
            case 'PGRES_COPY_OUT':
            case 'PGRES_COPY_BOTH':
                break;
            default:
                this.readError('unrecognized command status: ' + status);
                break;
        }
        return status;
    }
    readData() {
        // read waiting data from the socket
        // e.g. clear the pending 'select'
        if (!this.$consumeInput()) {
            // if consumeInput returns false a read error has been encountered
            return this.readError();
        }
        // check if there is still outstanding data and wait for it
        if (this.$isBusy()) {
            return;
        }
        // load result object
        while (this.$getResult()) {
            let resultStatus = this.emitResult();
            // if the command initiated copy mode we need to break out of the read loop
            // so a substream can begin to read copy data
            if (resultStatus === 'PGRES_COPY_BOTH' || resultStatus === 'PGRES_COPY_OUT')
                break;
            // if reading multiple results, sometimes the following results might cause
            // a blocking read. in this scenario yield back off the reader until libpq is readable
            if (this.$isBusy())
                return;
        }
        if (this.error) {
            let err = this.error;
            this.error = undefined;
            return this.rejectCallback(err);
        }
        this.resolveCallback(this.rows);
    }
    startReading() {
        if (this.isReading)
            return;
        this.isReading = true;
        this.$startRead();
    }
}
exports.PostgresClient = PostgresClient;
