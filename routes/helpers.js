/*
 * Shared helpers for the users and tasks routes.
 */

// An error that carries an HTTP status and a client-safe message
function ApiError(status, message, data) {
    this.status = status;
    this.message = message;
    this.data = data === undefined ? null : data;
}

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data === undefined ? null : data });
}

// Ids are 24 hex characters (MongoDB ObjectId)
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function parseJsonParam(query, key) {
    if (query[key] === undefined) return undefined;
    var value;
    try {
        value = JSON.parse(query[key]);
    } catch (e) {
        throw new ApiError(400, 'Invalid JSON in "' + key + '" parameter');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, '"' + key + '" parameter must be a JSON object');
    }
    return value;
}

function parseIntParam(query, key) {
    if (query[key] === undefined) return undefined;
    var value = Number(query[key]);
    if (query[key] === '' || !Number.isInteger(value) || value < 0) {
        throw new ApiError(400, '"' + key + '" parameter must be a non-negative integer');
    }
    return value;
}

function parseBoolParam(query, key) {
    var value = query[key];
    if (value === undefined) return false;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0' || value === '') return false;
    throw new ApiError(400, '"' + key + '" parameter must be true or false');
}

// Errors MongoDB/Mongoose raise because of bad client input in query parameters
function isQueryInputError(err) {
    return ['CastError', 'MongoServerError', 'StrictModeError', 'ObjectParameterError'].indexOf(err.name) !== -1;
}

// GET on a collection: where, sort, select, skip, limit, count
async function listHandler(Model, defaultLimit, req, res) {
    var where = parseJsonParam(req.query, 'where') || {};
    var sort = parseJsonParam(req.query, 'sort');
    var select = parseJsonParam(req.query, 'select');
    var skip = parseIntParam(req.query, 'skip');
    var limit = parseIntParam(req.query, 'limit');
    var count = parseBoolParam(req.query, 'count');

    var query;
    if (count) {
        var options = {};
        if (skip !== undefined) options.skip = skip;
        if (limit !== undefined) options.limit = limit;
        query = Model.countDocuments(where, options);
    } else {
        query = Model.find(where);
        if (sort) query = query.sort(sort);
        if (select) query = query.select(select);
        if (skip !== undefined) query = query.skip(skip);
        if (limit === undefined) limit = defaultLimit;
        if (limit !== undefined) query = query.limit(limit);
    }

    var result;
    try {
        result = await query.exec();
    } catch (err) {
        if (isQueryInputError(err)) throw new ApiError(400, 'Invalid query parameters');
        throw err;
    }
    send(res, 200, 'OK', result);
}

// GET on a single resource: only "select" applies
async function getOneHandler(Model, label, req, res) {
    // The URL id is checked first (404), then the select parameter (400)
    if (!isValidId(req.params.id)) throw new ApiError(404, label + ' not found');
    var select = parseJsonParam(req.query, 'select');

    var query = Model.findById(req.params.id);
    if (select) query = query.select(select);

    var doc;
    try {
        doc = await query.exec();
    } catch (err) {
        if (isQueryInputError(err)) throw new ApiError(400, 'Invalid select parameter');
        throw err;
    }
    if (!doc) throw new ApiError(404, label + ' not found');
    send(res, 200, 'OK', doc);
}

// Wrap an async route so thrown errors become JSON responses
function wrap(fn) {
    return function (req, res) {
        Promise.resolve(fn(req, res)).catch(function (err) {
            if (err instanceof ApiError) return send(res, err.status, err.message, err.data);
            if (err && err.code === 11000) return send(res, 400, 'A user with this email already exists');
            console.error(err);
            send(res, 500, 'Internal server error');
        });
    };
}

module.exports = {
    ApiError: ApiError,
    send: send,
    isValidId: isValidId,
    isNonEmptyString: isNonEmptyString,
    listHandler: listHandler,
    getOneHandler: getOneHandler,
    wrap: wrap
};
