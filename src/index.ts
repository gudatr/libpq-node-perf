//Clear the queue using this value to free up used promises
const EMPTY_FUNCTION = (_client: PostgresClient) => { };

export default class Postgres {
    private connectionString: string;
    private _prepareIndex = 0;

    private getPos = 0;
    private putPos = 0;
    private queue: ((client: PostgresClient) => void)[];
    private _queueSize: number;
    private connectionStack: PostgresClient[] = [];
    private stackPosition = 0;
    private escapeRegex = /\\|_|%/gi;
    private escapeMatches: { [Key: string]: string } = {};
    private escapeChar: string;
    private escapedApostrophe: string;
    client: any;

    public constructor(private config: ClientConfig) {

        this.queue = [];
        this._queueSize = config.queueSize ?? 200000;
        this.escapeChar = config.escapeChar ?? '\\';
        this.escapedApostrophe = this.escapeChar + "'";
        this.escapeRegex = new RegExp(this.escapeChar.replace(/\\/g, '\\\\') + "|_|%", "gi");

        this.escapeMatches = {
            [this.escapeChar]: this.escapeChar + this.escapeChar,
            "_": this.escapeChar + "_",
            "%": this.escapeChar + "%"
        };

        if (!config.socket) {
            this.connectionString = `postgresql://${config.user}:${config.password ?? ''}@${config.host}:${config.port}/${config.database}`;
        } else {
            this.connectionString = `postgresql://${config.user}@/${config.database}?host=${config.socket}`;
        }

        if (!config.parseInt8AsString) {
            types[20] = parseInt;
        }

    }

    /**
     * @returns the total size of the internal query queue 
     */
    public queueSize() {
        return this.queueSize;
    }

    /**
     * @returns the size of the queue currently occupied by waiting queries 
     */
    public queueUsage() {
        let diff = this.putPos - this.getPos;

        if (this.getPos < this.putPos) return diff;

        return this._queueSize + diff;
    }

    /**
     * Initializes the pool with client instances and sets their search_path to the schema specified in the client config
     * Await this function to make sure your app doesn't query the pool before it is ready
     */
    public async initialize() {
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
    public connect(): Promise<PostgresClient> {
        return new Promise(async (resolve: (client: PostgresClient) => void) => {
            if (++this.putPos >= this._queueSize) this.putPos = 0;
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
    public async query(name: string, text: string, values: any[]) {
        let client = await this.connect();
        try {
            return await client.query(name, text, values);
        } finally {
            this.release(client);
        }
    }

    /**
     * Query a string directly. Do not use it for transactions as it does pick the next available client for the query
     * @param query 
     * @returns 
     */
    public async queryString(query: string): Promise<any[]> {
        let client = await this.connect();
        try {
            return await client.queryString(query);
        } finally {
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
    public async queryCount(name: string, text: string, values: any[]) {
        let client = await this.connect();
        try {
            return await client.queryCount(name, text, values);
        } finally {
            this.release(client);
        }
    }

    /**
     * Query a string directly and return the affected row count
     * @param query 
     * @returns 
     */
    public async queryStringCount(query: string): Promise<number> {
        let client = await this.connect();
        try {
            return await client.queryStringCount(query);
        } finally {
            this.release(client);
        }
    }

    /**
     * Release a client back into the pool for queries
     * @param client 
     */
    public release(client: PostgresClient) {
        this.connectionStack[++this.stackPosition] = client;
        this.tick();
    }

    /**
     * Grab a waiting query from the queue and execute it on the next available client
     */
    private tick() {
        while (this.stackPosition > -1 && this.getPos !== this.putPos) {
            if (++this.getPos >= this._queueSize) this.getPos = 0;
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
    public getPrepareIdentifier(): string {
        return (this._prepareIndex++).toString(36);
    }

    /**
    * Will transform the provided array into a string postgresql can recognize as a dynamic array.
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    public transformArray(array: (number[] | boolean[])): string {
        return '{' + array + '}';
    }

    /**
    * Will transform the provided string array into a string postgresql can recognize as a dynamic array
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    public transformStringArray(array: (string[])): string {
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
    public escapeWildcards(input: string): string {
        return input.replace(this.escapeRegex, (matched) => {
            return this.escapeMatches[matched];
        });
    }
}

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
export class ClientConfig {
    constructor(
        public user: string,
        public host: string,
        public port: number,
        public database: string,
        public schema: string,
        public socket: string | undefined,
        public password: string | undefined,
        public threads: number = 10,
        public queueSize: number = 65535,
        public escapeChar: string = '\\',
        public valuesOnly: boolean = false,
        public parseInt8AsString: boolean = false,
    ) { }
}

let Libpq = require("libpq");
let typeParsers = require('pg-types');

//Reduces the lookup time for the parser
let typesFlat = [];
const returnValue = function (val: any) {
    return val;
}

for (let i = 0; i < 8192; i++) {
    typesFlat[i] = typeParsers.getTypeParser(i, 'text');
    if (typesFlat[i].name === 'noParse') typesFlat[i] = returnValue;
}

export const types = typesFlat;

const NOTIFICATION = 'notification';

export class PostgresClient extends Libpq {
    private parse: (arg: number) => any;
    private consumeFields: () => any;
    private isReading = false;
    private resolveCallback = (rows: any) => { };
    private rejectCallback = (err: any) => { };
    private error: Error | undefined = undefined;
    private fieldCount = 0;
    private statementName = '';
    private names: string[] = [];
    private types: any[] = [];
    private rows: any[] = [];
    private count: boolean = false;
    private prepared: { [Key: string]: ResultInfo } = {};

    private namesNonPrepared: string[] = [];
    private typesNonPrepared: any[] = [];

    /**
     * Execute a statement, prepare it if it has not been prepared already.
     * @param queryName 
     * @param text 
     * @param values 
     * @returns 
     */
    public query(queryName: string, text: string, values: any[]): Promise<any[]> {

        let preparedInfo = this.prepared[queryName];

        if (preparedInfo === undefined) {
            return new Promise((resolve: (result: any[]) => void, reject) => {
                this.prepareStatement(queryName, text, values.length, reject, () => {
                    this.fieldCount = -1;
                    this.names = [];
                    this.types = [];
                    this.statementName = queryName;
                    this.executeStatement(queryName, values, reject, resolve);
                });
            });
        }

        return new Promise((resolve: (result: any[]) => void, reject) => {
            this.fieldCount = preparedInfo.fieldCount;
            this.names = preparedInfo.names;
            this.types = preparedInfo.types;
            this.executeStatement(queryName, values, reject, resolve);
        });
    }

    /**
     * Query a string directly. Useful for starting transactions, etc.
     * @param query 
     * @returns 
     */
    public queryString(query: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.fieldCount = -1;
            this.names = this.namesNonPrepared;
            this.types = this.typesNonPrepared;
            this.statementName = '';
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
    public async queryCount(queryName: string, text: string, values: any[]): Promise<number> {
        this.count = true;
        return await this.query(queryName, text, values) as any;
    }

    /**
     * Query a string directly and return the affected row count
     * @param query 
     * @returns affected row count
     */
    public async queryStringCount(query: string): Promise<number> {
        this.count = true;
        return await this.queryString(query) as any;
    }

    /**
     * Release the client back into the pool
     */
    public release() {
        this.parentPool.release(this);
    }

    constructor(valuesOnly: boolean, private parentPool: Postgres) {
        super();

        this.parse = (valuesOnly ? this.parseArray : this.parseObject).bind(this);
        this.consumeFields = (valuesOnly ? this.consumeFieldsArray : this.consumeFieldsObject).bind(this);

        this.on('readable', this.readData.bind(this));

        this.on('newListener', (event: string) => {
            if (event !== NOTIFICATION) return;
            this.startReading()
        })
    }

    private readValue(rowIndex: number, fieldIndex: number) {
        let rawValue = this.$getvalue(rowIndex, fieldIndex);
        if (rawValue === '' && this.$getisnull(rowIndex, fieldIndex)) return null;
        return this.types[fieldIndex](rawValue);
    }

    private parseObject(rowIndex: number) {
        let row: any = {};
        for (let fieldIndex = 0; fieldIndex < this.fieldCount; fieldIndex++) {
            row[this.names[fieldIndex]] = this.readValue(rowIndex, fieldIndex)
        }
        return row;
    }

    private parseArray(rowIndex: number) {
        let row = [];
        for (let fieldIndex = 0; fieldIndex < this.fieldCount; fieldIndex++) {
            row[fieldIndex] = this.readValue(rowIndex, fieldIndex);
        }
        return row;
    }

    private consumeFieldsObject() {
        let tupleCount = this.$ntuples()
        this.rows = [];
        for (let i = 0; i < tupleCount; i++) {
            this.rows[i] = this.parse(i);
        }
    }

    private consumeFieldsArray() {
        let tupleCount = this.$ntuples()
        this.rows = [];
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
    public connect(connectionString: string) {
        this.names = [];
        this.types = [];
        if (!this.$connectSync(connectionString)) throw new Error(this.$getLastErrorMessage() || 'Unable to connect');
        if (!this.$setNonBlocking(1)) throw new Error(this.$getLastErrorMessage() || 'Unable to set non blocking to true');
    }

    private internalQuery(text: string, reject: (err: Error) => void, resolve: (res: any) => void) {
        this.stopReading();
        if (!this.$sendQuery(text)) return reject(new Error(this.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
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
    prepareStatement(statementName: string, text: string, nParams: number, reject: (err: Error) => void, resolve: (res: any) => void) {
        this.stopReading();
        if (!this.$sendPrepare(statementName, text, nParams)) return reject(new Error(this.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
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
    executeStatement(statementName: string, parameters: any[], reject: (err: Error) => void, resolve: (res: any) => void) {
        this.stopReading();
        if (!this.$sendQueryPrepared(statementName, parameters)) return reject(new Error(this.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }

    private waitForDrain() {
        let res = this.$flush();
        // res of 0 is success
        if (res === 0) return this.startReading();
        // res of -1 is failure
        if (res === -1) return this.rejectCallback(this.$getLastErrorMessage());
        // otherwise outgoing message didn't flush to socket, wait again
        this.$startWrite();

        this.once('writable', this.waitForDrain);
    }

    private readError(message: string | undefined = undefined) {
        this.emit('error', new Error(message || this.$getLastErrorMessage()));
    }

    private stopReading() {
        if (!this.isReading) return;
        this.isReading = false;
        this.$stopRead();
    }

    private getResultInfo() {
        this.fieldCount = this.$nfields();

        for (let x = 0; x < this.fieldCount; x++) {
            this.names[x] = this.$fname(x);
            this.types[x] = types[this.$ftype(x)];
        }
    }

    private emitResult(): string {
        let status = this.$resultStatus();
        switch (status) {
            case 'PGRES_TUPLES_OK':
            case 'PGRES_COMMAND_OK':
            case 'PGRES_EMPTY_QUERY':
                if (this.count) {
                    this.count = false;
                    this.rows = +this.$cmdTuples() as any;
                    break;
                }

                if (this.fieldCount === -1) {

                    this.getResultInfo();

                    if (this.statementName !== '') {
                        this.prepared[this.statementName] = {
                            fieldCount: this.fieldCount,
                            names: this.names,
                            types: this.types
                        };
                    }
                }

                this.consumeFields();

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

    private readData() {
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
            if (resultStatus === 'PGRES_COPY_BOTH' || resultStatus === 'PGRES_COPY_OUT') break;

            // if reading multiple results, sometimes the following results might cause
            // a blocking read. in this scenario yield back off the reader until libpq is readable
            if (this.$isBusy()) return;
        }

        if (this.error) {
            let err = this.error;
            this.error = undefined;
            return this.rejectCallback(err);
        }

        this.resolveCallback(this.rows);
    }

    private startReading() {
        if (this.isReading) return
        this.isReading = true
        this.$startRead()
    }
}

class ResultInfo {
    public fieldCount!: number;
    public names!: string[];
    public types!: ((attr: any) => any)[];
};

function returnSameValue(value: any) {
    return value;
}