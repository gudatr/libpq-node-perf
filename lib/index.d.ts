export default class Postgres {
    private config;
    private connectionString;
    private _prepareIndex;
    private getPos;
    private putPos;
    private queue;
    private _queueSize;
    private connectionStack;
    private stackPosition;
    private escapeRegex;
    private escapeMatches;
    private escapeChar;
    private escapedApostrophe;
    client: any;
    constructor(config: ClientConfig);
    /**
     * @returns the total size of the internal query queue
     */
    queueSize(): () => any;
    /**
     * @returns the size of the queue currently occupied by waiting queries
     */
    queueUsage(): number;
    /**
     * Initializes the pool with client instances and sets their search_path to the schema specified in the client config
     * Await this function to make sure your app doesn't query the pool before it is ready
     */
    initialize(): Promise<void>;
    /**
     * Grab a client from the pool or wait until one becomes available and the internal tick is called
     * @returns
     */
    connect(): Promise<PostgresClient>;
    /**
     * Get a client from the pool, execute the query and return it afterwards (even if there is an error)
     * @param name
     * @param text
     * @param values
     * @returns
     */
    query(name: string, text: string, values: any[]): Promise<any[]>;
    /**
     * Query a string directly. Do not use it for transactions as it does pick the next available client for the query
     * @param query
     * @returns
     */
    queryString(query: string): Promise<any[]>;
    /**
     * Get a client from the pool, execute the query and return the affected row count
     * @param name
     * @param text
     * @param values
     * @returns
     */
    queryCount(name: string, text: string, values: any[]): Promise<number>;
    /**
     * Query a string directly and return the affected row count
     * @param query
     * @returns
     */
    queryStringCount(query: string): Promise<number>;
    /**
     * Release a client back into the pool for queries
     * @param client
     */
    release(client: PostgresClient): void;
    /**
     * Grab a waiting query from the queue and execute it on the next available client
     */
    private tick;
    /**
     * This will get you a unique, smallest possible string on each call.
     * A helper function for creating prepared statements
     * @returns string
     */
    getPrepareIdentifier(): string;
    /**
    * Will transform the provided array into a string postgresql can recognize as a dynamic array.
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    transformArray(array: (number[] | boolean[])): string;
    /**
    * Will transform the provided string array into a string postgresql can recognize as a dynamic array
    * Instead of WHERE column IN ($1) you should be using WHERE column = ANY($1) so the conversion is performed
    * @returns string
    */
    transformStringArray(array: (string[])): string;
    /**
     * If you want to run quries using LIKE you can pass user input through here to
     * escape characters that are considered for patterns if the value is a string
     * @param input
     * @returns string
     */
    escapeWildcards(input: string): string;
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
export declare class ClientConfig {
    user: string;
    host: string;
    port: number;
    database: string;
    schema: string;
    socket: string | undefined;
    password: string | undefined;
    threads: number;
    queueSize: number;
    escapeChar: string;
    valuesOnly: boolean;
    parseInt8AsString: boolean;
    constructor(user: string, host: string, port: number, database: string, schema: string, socket: string | undefined, password: string | undefined, threads?: number, queueSize?: number, escapeChar?: string, valuesOnly?: boolean, parseInt8AsString?: boolean);
}
declare let Libpq: any;
export declare const types: any[];
export declare class PostgresClient extends Libpq {
    private parentPool;
    private parse;
    private consumeFields;
    private isReading;
    private resolveCallback;
    private rejectCallback;
    private error;
    private fieldCount;
    private statementName;
    private names;
    private types;
    private rows;
    private count;
    private prepared;
    private namesNonPrepared;
    private typesNonPrepared;
    /**
     * Execute a statement, prepare it if it has not been prepared already.
     * @param queryName
     * @param text
     * @param values
     * @returns
     */
    query(queryName: string, text: string, values: any[]): Promise<any[]>;
    /**
     * Query a string directly. Useful for starting transactions, etc.
     * @param query
     * @returns
     */
    queryString(query: string): Promise<any[]>;
    /**
     * Execute a statement, prepare it if it has not been prepared already and return affected row count
     * @param queryName
     * @param text
     * @param values
     * @returns affected row count
     */
    queryCount(queryName: string, text: string, values: any[]): Promise<number>;
    /**
     * Query a string directly and return the affected row count
     * @param query
     * @returns affected row count
     */
    queryStringCount(query: string): Promise<number>;
    /**
     * Release the client back into the pool
     */
    release(): void;
    constructor(valuesOnly: boolean, parentPool: Postgres);
    private readValue;
    private parseObject;
    private parseArray;
    private consumeFieldsObject;
    private consumeFieldsArray;
    /**
     * Attempts to connect using the provided connection string. Blocking.
     * @param connectionString
     * @param cb
     * @returns
     */
    connect(connectionString: string): void;
    private internalQuery;
    /**
     * Prepares a statement, calls reject on fail, resolve on success
     * @param connectionString
     * @param cb
     * @returns
     */
    prepareStatement(statementName: string, text: string, nParams: number, reject: (err: Error) => void, resolve: (res: any) => void): void;
    /**
     * Executes a prepared statement, calls reject on fail, resolve on success
     * @param connectionString
     * @param cb
     * @returns
     */
    executeStatement(statementName: string, parameters: any[], reject: (err: Error) => void, resolve: (res: any) => void): void;
    private waitForDrain;
    private readError;
    private stopReading;
    private getResultInfo;
    private emitResult;
    private readData;
    private startReading;
}
export {};
