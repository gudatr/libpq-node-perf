"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientConfig = exports.PostgresClient = exports.asyncSleep = void 0;
var process_1 = require("process");
var Client = require('pg-native');
var POOL_QUEUE_SIZE = 65534 * 4;
var EMPTY_FUNCTION = function (_client) { };
var ILLEGAL_LIKE_CHARS = {
    "\\": "\\\\",
    "_": "\\_",
    "%": "\\%"
};
var ILLEGAL_CHAR_REGEX = /\\|_|%/gi;
var GET_POS = 0;
var PUT_POS = 0;
var queue = new Array(POOL_QUEUE_SIZE);
var connectionStack = [];
var stackPosition = 0;
function asyncSleep(milliseconds) {
    return new Promise(function (resolve) { return setTimeout(resolve, milliseconds); });
}
exports.asyncSleep = asyncSleep;
var PostgresClient = /** @class */ (function () {
    function PostgresClient(client) {
        this.client = client;
        this.prepared = {};
    }
    PostgresClient.prototype.query = function (queryName, text, values) {
        var _this = this;
        if (this.prepared[queryName]) {
            return new Promise(function (resolve, reject) {
                _this.client.execute(queryName, values, reject, resolve);
            });
        }
        return new Promise(function (resolve, reject) {
            _this.client.prepare(queryName, text, values.length, reject, function () {
                _this.prepared[queryName] = 1;
                _this.client.execute(queryName, values, reject, resolve);
            });
        });
    };
    PostgresClient.prototype.queryString = function (query) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.client.query(query, reject, resolve);
        });
    };
    PostgresClient.prototype.release = function () {
        Postgres.release(this);
    };
    return PostgresClient;
}());
exports.PostgresClient = PostgresClient;
var Postgres = /** @class */ (function () {
    function Postgres() {
    }
    Postgres.Init = function (threads) {
        if (Postgres.config !== undefined)
            throw new Error('Postgres pool is already initialized.');
        var config = Postgres.config = new ClientConfig('postgres', '127.0.0.1', 5432, 'template1', !['win32', 'darwin'].includes(process.platform), undefined, threads);
        if (!config.socket) {
            Postgres.connectionString = "postgresql://" + config.user + ":" + config.password + "@" + config.host + ":" + config.port + "/" + config.database;
        }
        else {
            Postgres.connectionString = "postgresql://" + config.user + "@/" + config.database + "?host=/var/run/postgresql/";
        }
        for (var i = 0; i < config.size; i++) {
            var client = Client();
            client.connectSync(Postgres.connectionString, function (err) { if (err) {
                console.log("DB connection failed. Exiting", err);
                (0, process_1.exit)(1);
            } });
            client.query("SET search_path TO public", function (err) {
                if (err) {
                    console.log("Setting search path failed. Exiting", err);
                    (0, process_1.exit)(1);
                }
            }, EMPTY_FUNCTION);
            connectionStack[i] = new PostgresClient(client);
        }
        stackPosition = config.size - 1;
        console.log("[Postgres] Pool initialized");
    };
    Postgres.query = function (name, text, values) {
        return __awaiter(this, void 0, void 0, function () {
            var client;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.connect()];
                    case 1:
                        client = _a.sent();
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, , 4, 5]);
                        return [4 /*yield*/, client.query(name, text, values)];
                    case 3: return [2 /*return*/, _a.sent()];
                    case 4:
                        this.release(client);
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    Postgres.connect = function () {
        var _this = this;
        return new Promise(function (resolve) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                queue[++PUT_POS >= POOL_QUEUE_SIZE ? PUT_POS = 0 : PUT_POS] = resolve;
                this.tick();
                return [2 /*return*/];
            });
        }); });
    };
    Postgres.release = function (client) {
        connectionStack[++stackPosition] = client;
        this.tick();
    };
    Postgres.tick = function () {
        while (stackPosition > -1 && GET_POS !== PUT_POS) {
            var handler = queue[++GET_POS >= POOL_QUEUE_SIZE ? GET_POS = 0 : GET_POS];
            queue[GET_POS] = EMPTY_FUNCTION;
            handler(connectionStack[stackPosition--]);
        }
    };
    Postgres.GetPrepareIdentifier = function () {
        return (this._prepareIndex++).toString(36);
    };
    Postgres.EscapeForLike = function (input) {
        return input.replace(ILLEGAL_CHAR_REGEX, function (matched) {
            return ILLEGAL_LIKE_CHARS[matched];
        }) + '%';
    };
    Postgres.config = undefined;
    Postgres._prepareIndex = 0;
    return Postgres;
}());
exports.default = Postgres;
var ClientConfig = /** @class */ (function () {
    function ClientConfig(user, host, port, database, socket, password, size) {
        if (socket === void 0) { socket = true; }
        if (password === void 0) { password = undefined; }
        if (size === void 0) { size = 10; }
        this.user = user;
        this.host = host;
        this.port = port;
        this.database = database;
        this.socket = socket;
        this.password = password;
        this.size = size;
    }
    return ClientConfig;
}());
exports.ClientConfig = ClientConfig;
