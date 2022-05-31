import { exit } from 'process';

const Client = require('pg-native')

const POOL_QUEUE_SIZE = 65534 * 4;

const EMPTY_FUNCTION = (_client: PostgresClient) => { };

export interface Dictionary<T> {
    [Key: string]: T;
}

const ILLEGAL_LIKE_CHARS: Dictionary<string> = {
    "\\": "\\\\",
    "_": "\\_",
    "%": "\\%"
};

const ILLEGAL_CHAR_REGEX = /\\|_|%/gi;

let GET_POS = 0;
let PUT_POS = 0;
let queue: ((client: PostgresClient) => void)[] = new Array(POOL_QUEUE_SIZE);
let connectionStack: PostgresClient[] = [];
let stackPosition = 0;

export function asyncSleep(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class PostgresClient {

    private prepared: Dictionary<number> = {};

    constructor(private client: any) { }

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

    public queryString(query: string): Promise<any[]> {
        return new Promise((resolve: (result: any[]) => void, reject) => {
            this.client.query(query, reject, resolve);
        });
    }

    public release() {
        Postgres.release(this);
    }


}

export default class Postgres {
    private static connectionString: string;
    private static config: ClientConfig | undefined = undefined;
    private static _prepareIndex = 0;

    static Init(threads: number) {

        if (Postgres.config !== undefined) throw new Error('Postgres pool is already initialized.');

        let config = Postgres.config = new ClientConfig(
            'postgres',
            '127.0.0.1',
            5432,
            'template1',
            !['win32', 'darwin'].includes(process.platform),
            undefined,
            threads);

        if (!config.socket) {
            Postgres.connectionString = `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
        } else {
            Postgres.connectionString = `postgresql://${config.user}@/${config.database}?host=/var/run/postgresql/`;
        }

        for (let i = 0; i < config.size; i++) {
            let client = Client();
            client.connectSync(Postgres.connectionString, (err: any) => { if (err) { console.log("DB connection failed. Exiting", err); exit(1); } });
            client.query(`SET search_path TO public`, (err: any) => {
                if (err) {
                    console.log("Setting search path failed. Exiting", err);
                    exit(1);
                }
            }, EMPTY_FUNCTION);
            connectionStack[i] = new PostgresClient(client);
        }
        stackPosition = config.size - 1;

        console.log("[Postgres] Pool initialized");
    }

    public static async query(name: string, text: string, values: any[]) {
        let client = await this.connect();
        try {
            return await client.query(name, text, values);
        } finally {
            this.release(client);
        }
    }

    public static connect(): Promise<PostgresClient> {
        return new Promise(async (resolve: (client: PostgresClient) => void) => {
            queue[++PUT_POS >= POOL_QUEUE_SIZE ? PUT_POS = 0 : PUT_POS] = resolve;
            this.tick();
        });
    }

    public static release(client: PostgresClient) {
        connectionStack[++stackPosition] = client;
        this.tick();
    }

    private static tick() {
        while (stackPosition > -1 && GET_POS !== PUT_POS) {
            let handler = queue[++GET_POS >= POOL_QUEUE_SIZE ? GET_POS = 0 : GET_POS];
            queue[GET_POS] = EMPTY_FUNCTION;
            handler(connectionStack[stackPosition--]);
        }
    }

    static GetPrepareIdentifier(): string {
        return (this._prepareIndex++).toString(36);
    }

    static EscapeForLike(input: string): string {
        return input.replace(ILLEGAL_CHAR_REGEX, function (matched) {
            return ILLEGAL_LIKE_CHARS[matched];
        }) + '%';
    }

}

export class ClientConfig {
    constructor(
        public user: string,
        public host: string,
        public port: number,
        public database: string,
        public socket: boolean = true,
        public password: string | undefined = undefined,
        public size: number = 10
    ) { }
}