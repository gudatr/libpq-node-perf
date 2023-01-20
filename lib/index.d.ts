export declare class PostgresClient {
    private client;
    private parentPool;
    private prepared;
    constructor(client: any, parentPool: Postgres);
    query(queryName: string, text: string, values: any[]): Promise<any[]>;
    queryString(query: string): Promise<any[]>;
    release(): void;
}
export default class Postgres {
    private config;
    private connectionString;
    private _prepareIndex;
    private getPos;
    private putPos;
    private queue;
    private connectionStack;
    private stackPosition;
    private escapeRegex;
    private escapeMatches;
    private escapeChar;
    constructor(config: ClientConfig);
    query(name: string, text: string, values: any[]): Promise<any[]>;
    connect(): Promise<PostgresClient>;
    release(client: PostgresClient): void;
    private tick;
    GetPrepareIdentifier(): string;
    EscapeWildcards(input: string): string;
}
export declare class ClientConfig {
    user: string;
    host: string;
    port: number;
    database: string;
    schema: string;
    socket: boolean;
    password: string | undefined;
    threads: number;
    queueSize: number;
    escapeChar: string;
    constructor(user: string, host: string, port: number, database: string, schema: string, socket?: boolean, password?: string | undefined, threads?: number, queueSize?: number, escapeChar?: string);
}
