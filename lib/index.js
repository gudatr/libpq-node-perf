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
    queryString(query) {
        return new Promise((resolve, reject) => {
            this.client.query(query, reject, resolve);
        });
    }
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
    async initialize() {
        for (let i = 0; i < this.config.threads; i++) {
            let client = Client();
            client.connectSync(this.connectionString, (err) => {
                if (err)
                    throw err;
            });
            await new Promise((resolve, reject) => {
                this.client.query(`SET search_path TO ${this.config.schema}`, reject, resolve);
            });
            this.connectionStack[i] = new PostgresClient(client, this);
        }
        this.stackPosition = this.config.threads - 1;
    }
    async query(name, text, values) {
        let client = await this.connect();
        try {
            return await client.query(name, text, values);
        }
        finally {
            this.release(client);
        }
    }
    connect() {
        return new Promise(async (resolve) => {
            this.queue[++this.putPos >= this.queue.length ? this.putPos = 0 : this.putPos] = resolve;
            this.tick();
        });
    }
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
    release(client) {
        this.connectionStack[++this.stackPosition] = client;
        this.tick();
    }
    tick() {
        while (this.stackPosition > -1 && this.getPos !== this.putPos) {
            let handler = this.queue[++this.getPos >= this.queue.length ? this.getPos = 0 : this.getPos];
            this.queue[this.getPos] = EMPTY_FUNCTION;
            handler(this.connectionStack[this.stackPosition--]);
        }
    }
    GetPrepareIdentifier() {
        return (this._prepareIndex++).toString(36);
    }
    TransformArray(array) {
        return '{' + array.join(',') + '}';
    }
    TransformStringArray(array) {
        for (let i = 0; i < array.length; i++) {
            array[i] = '"' + array[i].replace(this.escapeArrayRegex, (matched) => {
                return this.escapeArrayMatches[matched];
            }) + '"';
        }
        return '{' + array.join(',') + '}';
    }
    EscapeWildcards(input) {
        return input.replace(this.escapeRegex, (matched) => {
            return this.escapeMatches[matched];
        });
    }
}
exports.default = Postgres;
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
