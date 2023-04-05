import EventEmitter from "events";

const EMPTY_FUNCTION = (_client: PostgresClient) => { };


export default class Postgres {
    private connectionString: string;
    private _prepareIndex = 0;

    private getPos = 0;
    private putPos = 0;
    private queue: ((client: PostgresClient) => void)[];
    private connectionStack: PostgresClient[] = [];
    private stackPosition = 0;
    private escapeRegex = /\\|_|%/gi;
    private escapeMatches: { [Key: string]: string } = {};
    private escapeChar: string;
    private escapeArrayRegex = /{|}|"/gi;
    private escapeArrayMatches: { [Key: string]: string } = {};
    client: any;

    public constructor(private config: ClientConfig) {

        this.queue = new Array(config.queueSize);
        this.escapeChar = config.escapeChar;
        this.escapeRegex = new RegExp(this.escapeChar.replaceAll('\\', '\\\\') + "|_|%", "gi");

        this.escapeMatches = {
            [this.escapeChar]: this.escapeChar + this.escapeChar,
            "_": this.escapeChar + "_",
            "%": this.escapeChar + "%"
        };

        this.escapeArrayMatches = {
            "{": this.escapeChar + "{",
            "}": this.escapeChar + "}",
            '"': this.escapeChar + '"'
        };

        if (!config.socket) {
            this.connectionString = `postgresql://${config.user}:${config.password ?? ''}@${config.host}:${config.port}/${config.database}`;
        } else {
            this.connectionString = `postgresql://${config.user}@/${config.database}?host=${config.socket}`;
        }

    }

    /**
     * Initializes the pool with client instances and sets their search_path to the schema specified in the client config
     * Await this function to make sure your app doesn't query the pool before it is ready
     */
    public async initialize() {
        for (let i = 0; i < this.config.threads; i++) {
            let client = this.connectionStack[i] = new PostgresClient(this.config.valuesOnly, this);

            client.connect(this.connectionString, (err: any) => {
                if (err) throw err;
            });

            await client.queryString(`SET search_path TO ${this.config.schema}`);
        }
        this.stackPosition = this.config.threads - 1;
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
     * Grab a client from the pool or wait until one is freed and the internal tick is called
     * @returns 
     */
    public connect(): Promise<PostgresClient> {
        return new Promise(async (resolve: (client: PostgresClient) => void) => {
            this.queue[++this.putPos >= this.queue.length ? this.putPos = 0 : this.putPos] = resolve;
            this.tick();
        });
    }

    /**
     * Query a string directly. Do not use it for transactions as it does pick the next available client for the query
     * @param query 
     * @returns 
     */
    public queryString(query: string): Promise<any[]> {
        return new Promise(async (resolve: (result: any[]) => void, reject) => {
            let client = await this.connect();
            try {
                resolve(await client.queryString(query));
            } catch (err) {
                reject(err);
            } finally {
                this.release(client);
            }
        });
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
            let handler = this.queue[++this.getPos >= this.queue.length ? this.getPos = 0 : this.getPos];
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
        return '{' + array.join(',') + '}';
    }

    /**
    * Will transform the provided string array into a string postgresql can recognize as a dynamic array
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    public transformStringArray(array: (string[])): string {
        for (let i = 0; i < array.length; i++) {
            array[i] = '"' + array[i].replace(this.escapeArrayRegex, (matched) => {
                return this.escapeArrayMatches[matched];
            }) + '"';
        }
        return '{' + array.join(',') + '}';
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
        public valuesOnly: boolean = false
    ) { }
}

let Libpq = require('libpq');
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

export class PostgresClient extends EventEmitter {
    private parse: (arg: number) => any;
    private pq: any;
    private isReading = false;
    private resolveCallback = (rows: any) => { };
    private rejectCallback = (err: any) => { };
    private error: Error | undefined = undefined;
    private fieldCount = 0;
    private names: string[] = [];
    private types: any[] = [];
    private rows: any[] = [];
    private prepared: { [Key: string]: boolean } = {};

    /**
     * Execute a statement, prepare it if it has not been prepared already.
     * @param queryName 
     * @param text 
     * @param values 
     * @returns 
     */
    public query(queryName: string, text: string, values: any[]): Promise<any[]> {

        if (this.prepared[queryName]) {
            return new Promise((resolve: (result: any[]) => void, reject) => {
                this.execute(queryName, values, reject, resolve);
            });
        }

        return new Promise((resolve: (result: any[]) => void, reject) => {
            this.prepare(queryName, text, values.length, reject, () => {
                this.prepared[queryName] = true;
                this.execute(queryName, values, reject, resolve);
            });
        });
    }

    /**
     * Query a string directly. Useful for starting transactions, etc.
     * @param query 
     * @returns 
     */
    public queryString(query: string): Promise<any[]> {
        return new Promise((resolve: (result: any[]) => void, reject) => {
            this.internalQuery(query, reject, resolve);
        });
    }

    /**
     * Release the client back into the pool
     */
    public release() {
        this.parentPool.release(this);
    }

    constructor(valuesOnly: boolean = false, private parentPool: Postgres) {
        super();

        this.parse = (valuesOnly ? this.parseArray : this.parseObject).bind(this);

        this.pq = new Libpq();

        this.pq.on('readable', this.readData.bind(this));

        this.on('newListener', (event: string) => {
            if (event !== NOTIFICATION) return;
            this.startReading()
        })
    }

    private readValue(rowIndex: number, fieldIndex: number) {
        let rawValue = this.pq.$getvalue(rowIndex, fieldIndex)
        if (rawValue === '' && this.pq.$getisnull(rowIndex, fieldIndex)) return null
        let parser = this.types[fieldIndex]
        if (parser) return parser(rawValue)
        return rawValue
    }

    private parseObject(rowIndex: number) {
        let row: any = {};
        for (let fieldIndex = 0; fieldIndex < this.fieldCount; fieldIndex++) {
            row[this.names[fieldIndex]] = this.readValue(rowIndex, fieldIndex)
        }
        return row;
    }

    private parseArray(rowIndex: number) {
        let row = new Array(this.fieldCount);
        for (let fieldIndex = 0; fieldIndex < this.fieldCount; fieldIndex++) {
            row[fieldIndex] = this.readValue(rowIndex, fieldIndex);
        }
        return row;
    }

    private consumeFields() {
        this.fieldCount = this.pq.$nfields()
        for (let x = 0; x < this.fieldCount; x++) {
            this.names[x] = this.pq.$fname(x)
            this.types[x] = types[this.pq.$ftype(x)]
        }

        let tupleCount = this.pq.$ntuples()
        this.rows = new Array(tupleCount)
        for (let i = 0; i < tupleCount; i++) {
            this.rows[i] = this.parse(i);
        }
    }

    connect(params: string, cb: (err: Error) => any) {
        this.names = [];
        this.types = [];
        this.pq.connectSync(params);
        if (!this.pq.$setNonBlocking(1)) return cb(new Error('Unable to set non-blocking to true'));
    }

    private internalQuery(text: string, reject: (err: Error) => void, resolve: (res: any) => void) {
        this.stopReading();
        if (!this.pq.$sendQuery(text)) return reject(new Error(this.pq.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }

    prepare(statementName: string, text: string, nParams: number, reject: (err: Error) => void, resolve: (res: any) => void) {
        this.stopReading();
        if (!this.pq.$sendPrepare(statementName, text, nParams)) return reject(new Error(this.pq.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }

    execute(statementName: string, parameters: any[], reject: (err: Error) => void, resolve: (res: any) => void) {
        this.stopReading();
        if (!this.pq.$sendQueryPrepared(statementName, parameters)) return reject(new Error(this.pq.$getLastErrorMessage() || 'Something went wrong dispatching the query'));
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
        this.waitForDrain();
    }

    private waitForDrain() {
        let res = this.pq.$flush();
        // res of 0 is success
        if (res === 0) return this.startReading();
        // res of -1 is failure
        if (res === -1) return this.rejectCallback(this.pq.$getLastErrorMessage());
        // otherwise outgoing message didn't flush to socket, wait again
        return this.pq.writable(this.waitForDrain)
    }

    private readError(message: string | undefined = undefined) {
        this.emit('error', new Error(message || this.pq.$getLastErrorMessage()));
    }

    private stopReading() {
        if (!this.isReading) return;
        this.isReading = false;
        this.pq.$stopRead();
    }

    private emitResult(): string {
        let status = this.pq.$resultStatus();
        switch (status) {
            case 'PGRES_TUPLES_OK':
            case 'PGRES_COMMAND_OK':
            case 'PGRES_EMPTY_QUERY':
                this.consumeFields();
                break;
            case 'PGRES_FATAL_ERROR':
                this.error = new Error(this.pq.$resultErrorMessage());
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
        if (!this.pq.$consumeInput()) {
            // if consumeInput returns false a read error has been encountered
            return this.readError();
        }

        // check if there is still outstanding data and wait for it
        if (this.pq.$isBusy()) {
            return;
        }

        // load result object
        while (this.pq.$getResult()) {
            let resultStatus = this.emitResult();

            // if the command initiated copy mode we need to break out of the read loop
            // so a substream can begin to read copy data
            if (resultStatus === 'PGRES_COPY_BOTH' || resultStatus === 'PGRES_COPY_OUT') break;

            // if reading multiple results, sometimes the following results might cause
            // a blocking read. in this scenario yield back off the reader until libpq is readable
            if (this.pq.$isBusy()) return;
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
        this.pq.$startRead()
    }
}