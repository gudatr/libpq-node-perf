const Client = require('pg-native')

const EMPTY_FUNCTION = (_client: PostgresClient) => { };
const ILLEGAL_CHAR_REGEX = /\\|_|%/gi;
const ILLEGAL_LIKE_CHARS: Dictionary<string> = {
    "\\": "\\\\",
    "_": "\\_",
    "%": "\\%"
};

export interface Dictionary<T> {
    [Key: string]: T;
}

export class PostgresClient {

    private prepared: Dictionary<number> = {};

    constructor(private client: any, private parentPool: Postgres) { }

    /**
     * Execute a statement, prepare it if it has not been prepared already.
     * You best use the GetPrepareIdentifier function for optimal performance.
     * @param queryName 
     * @param text 
     * @param values 
     * @returns 
     */
    public query(queryName: string, text: string, values: any[]): Promise<any[]> {

        if (this.prepared[queryName]) {
            return new Promise((resolve: (result: any[]) => void, reject) => {
                this.client.execute(queryName, values, reject, resolve);
            });
        }

        return new Promise((resolve: (result: any[]) => void, reject) => {
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
    public queryString(query: string): Promise<any[]> {
        return new Promise((resolve: (result: any[]) => void, reject) => {
            this.client.query(query, reject, resolve);
        });
    }

    /**
     * Release the client back into the pool
     */
    public release() {
        this.parentPool.release(this);
    }
}

export default class Postgres {
    private connectionString: string;
    private _prepareIndex = 0;

    private getPos = 0;
    private putPos = 0;
    private queue: ((client: PostgresClient) => void)[];
    private connectionStack: PostgresClient[] = [];
    private stackPosition = 0;

    public constructor(private config: ClientConfig) {

        this.queue = new Array(config.queueSize);

        if (!config.socket) {
            this.connectionString = `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
        } else {
            this.connectionString = `postgresql://${config.user}@/${config.database}?host=/var/run/postgresql/`;
        }

        for (let i = 0; i < config.threads; i++) {
            let client = Client();

            client.connectSync(this.connectionString, (err: any) => {
                if (err) throw err;
            });

            client.query(`SET search_path TO ${config.schema}`, (err: any) => {
                if (err) throw err;
            }, EMPTY_FUNCTION);

            this.connectionStack[i] = new PostgresClient(client, this);
        }
        this.stackPosition = config.threads - 1;
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
     * Release a client back into the pool for queries
     * @param client 
     */
    public release(client: PostgresClient) {
        this.connectionStack[++this.stackPosition] = client;
        this.tick();
    }

    /**
     * Grab a waiting query from the queue and execute it on the top available client
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
     * @returns 
     */
    public GetPrepareIdentifier(): string {
        return (this._prepareIndex++).toString(36);
    }

    /**
     * If you want to apply full text search using LIKE you can pass user input through here to 
     * escape characters that are considered for patterns
     * @param input 
     * @returns 
     */
    public EscapeForLike(input: string): string {
        return input.replace(ILLEGAL_CHAR_REGEX, function (matched) {
            return ILLEGAL_LIKE_CHARS[matched];
        });
    }
}

/**
 *         example config:
 *          'postgres',
 *          '127.0.0.1',
 *          5432,
 *          'template1',
 *          'public'
 *          !['win32', 'darwin'].includes(process.platform), // This way we get a socket on unix and a tcp connection on other systems
 *          undefined,
 *          10, //You have to test this value for your work load, this is only a recommendation
 *          65535
 */
export class ClientConfig {
    constructor(
        public user: string,
        public host: string,
        public port: number,
        public database: string,
        public schema: string,
        public socket: boolean = true,
        public password: string | undefined = undefined,
        public threads: number = 10,
        public queueSize: number = 65535
    ) { }
}
