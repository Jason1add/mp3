/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api', require('./users.js')(router));
    app.use('/api', require('./tasks.js')(router));

    // Unknown endpoints
    app.use(function (req, res) {
        res.status(404).json({ message: 'Endpoint not found', data: null });
    });

    // Errors thrown before reaching a route, e.g. a malformed JSON body
    app.use(function (err, req, res, next) {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ message: 'Request body is not valid JSON', data: null });
        }
        console.error(err);
        res.status(err.status || 500).json({ message: 'Internal server error', data: null });
    });
};
