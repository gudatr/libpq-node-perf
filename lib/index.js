"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientConfig = exports.PostgresClient = void 0;
const Client = require('pg-native');
const EMPTY_FUNCTION = (_client) => { };
class PostgresClient {
    constructor(client, parentPool) {
        this.client = client;
        this.parentPool = parentPool;
        this.prepared = {};
    }
    /**
     * Execute a statement, prepare it if it has not been prepared already.
     * You best use the GetPrepareIdentifier function for optimal performance.
     * @param queryName
     * @param text
     * @param values
     * @returns
     */
    query(queryName, text, values) {
        if (this.prepared[queryName]) {
            return new Promise((resolve, reject) => {
                this.client.execute(queryName, values, reject, resolve);
            });
        }
        return new Promise((resolve, reject) => {
            this.client.prepare(queryName, text, values.length, reject, () => {
                this.prepared[queryName] = 1;
                this.client.execute(queryName, values, reject, resolve);
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
            this.client.query(query, reject, resolve);
        });
    }
    /**
     * Release the client back into the pool
     */
    release() {
        this.parentPool.release(this);
    }
}
exports.PostgresClient = PostgresClient;
class Postgres {
    constructor(config) {
        this.config = config;
        this._prepareIndex = 0;
        this.getPos = 0;
        this.putPos = 0;
        this.connectionStack = [];
        this.stackPosition = 0;
        this.escapeRegex = /\\|_|%/gi;
        this.escapeMatches = {};
        this.escapeArrayRegex = /{|}|"/gi;
        this.escapeArrayMatches = {};
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
            this.connectionString = `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
        }
        else {
            this.connectionString = `postgresql://${config.user}@/${config.database}?host=/var/run/postgresql/`;
        }
    }
    /**
     * Initializes the pool with client instances and sets their search_path to the schema specified in the client config
     * Await this function to make sure your app doesn't query the pool before it is ready
     */
    async initialize() {
        for (let i = 0; i < this.config.threads; i++) {
            let client = Client();
            client.connectSync(this.connectionString, (err) => {
                if (err)
                    throw err;
            });
            await new Promise((resolve, reject) => {
                client.query(`SET search_path TO ${this.config.schema}`, reject, resolve);
            });
            this.connectionStack[i] = new PostgresClient(client, this);
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
     * Grab a client from the pool or wait until one is freed and the internal tick is called
     * @returns
     */
    connect() {
        return new Promise(async (resolve) => {
            this.queue[++this.putPos >= this.queue.length ? this.putPos = 0 : this.putPos] = resolve;
            this.tick();
        });
    }
    /**
     * Query a string directly. Do not use it for transactions as it does pick the next available client for the query
     * @param query
     * @returns
     */
    queryString(query) {
        return new Promise(async (resolve, reject) => {
            let client = await this.connect();
            try {
                this.client.query(query, reject, resolve);
            }
            catch (err) {
                reject(err);
            }
            finally {
                this.release(client);
            }
        });
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
     * Grab a waiting query from the queue and execute it on the top available client
     */
    tick() {
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
    GetPrepareIdentifier() {
        return (this._prepareIndex++).toString(36);
    }
    /**
    * Will transform the provided array into a string postgresql can recognize as a dynamic array.
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    TransformArray(array) {
        return '{' + array.join(',') + '}';
    }
    /**
    * Will transform the provided string array into a string postgresql can recognize as a dynamic array
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    TransformStringArray(array) {
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
    EscapeWildcards(input) {
        return input.replace(this.escapeRegex, (matched) => {
            return this.escapeMatches[matched];
        });
    }
}
exports.default = Postgres;
/**
 *         example config:
 *          'postgres',
 *          '127.0.0.1',
 *          5432,
 *          'template1',
 *          'public'
 *          !['win32', 'darwin'].includes(process.platform), // This way we get a socket on unix and a tcp connection on other systems
 *          undefined,
 *          10, //You have to test the threads value for your work load, this is only a recommendation
 *          65535,
 *          \\
 */
class ClientConfig {
    constructor(user, host, port, database, schema, socket = true, password = undefined, threads = 10, queueSize = 65535, escapeChar = '\\') {
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
    }
}
exports.ClientConfig = ClientConfig;
