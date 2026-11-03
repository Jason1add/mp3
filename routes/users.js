var User = require('../models/user.js');
var Task = require('../models/task.js');
var h = require('./helpers.js');

var ApiError = h.ApiError;

// Check the request body (400 errors only); returns the cleaned fields
function parseUserBody(body) {
    body = body || {};
    if (!h.isNonEmptyString(body.name)) throw new ApiError(400, 'User name is required');
    if (!h.isNonEmptyString(body.email)) throw new ApiError(400, 'User email is required');

    var pendingTasks = body.pendingTasks;
    if (pendingTasks === undefined || pendingTasks === null) pendingTasks = [];
    if (!Array.isArray(pendingTasks)) throw new ApiError(400, 'pendingTasks must be a list of task ids');
    pendingTasks.forEach(function (id) {
        if (!h.isValidId(id)) throw new ApiError(400, 'pendingTasks contains an invalid task id');
    });

    // Remove duplicates, keep order
    pendingTasks = pendingTasks.filter(function (id, i) {
        return pendingTasks.indexOf(id) === i;
    });

    return { name: body.name, email: body.email, pendingTasks: pendingTasks };
}

// Checks that need the database, in the order of the spec
async function checkUserReferences(fields, userId) {
    var emailQuery = { email: fields.email };
    if (userId) emailQuery._id = { $ne: userId };
    if (await User.exists(emailQuery)) throw new ApiError(400, 'A user with this email already exists');

    var tasks = await Task.find({ _id: { $in: fields.pendingTasks } });
    if (tasks.length !== fields.pendingTasks.length) {
        throw new ApiError(404, 'pendingTasks contains a task that does not exist');
    }
    if (tasks.some(function (t) { return t.completed; })) {
        throw new ApiError(400, 'A completed task cannot be in pendingTasks');
    }
}

// Make tasks agree with the user's (new) pendingTasks and name
async function syncUserTasks(user) {
    var userId = user._id.toString();
    var ids = user.pendingTasks;

    // Pending tasks of this user that are no longer listed get unassigned
    await Task.updateMany(
        { assignedUser: userId, completed: false, _id: { $nin: ids } },
        { assignedUser: '', assignedUserName: 'unassigned' }
    );
    // All remaining tasks of this user (completed too) carry the current name
    await Task.updateMany({ assignedUser: userId }, { assignedUserName: user.name });
    // Listed tasks move away from any other user
    await User.updateMany(
        { _id: { $ne: userId }, pendingTasks: { $in: ids } },
        { $pull: { pendingTasks: { $in: ids } } }
    );
    await Task.updateMany({ _id: { $in: ids } }, { assignedUser: userId, assignedUserName: user.name });
}

module.exports = function (router) {

    var usersRoute = router.route('/users');

    usersRoute.get(h.wrap(function (req, res) {
        return h.listHandler(User, undefined, req, res);
    }));

    usersRoute.post(h.wrap(async function (req, res) {
        var fields = parseUserBody(req.body);
        await checkUserReferences(fields, null);

        var user = new User(fields);
        await user.save();
        await syncUserTasks(user);

        h.send(res, 201, 'User created', user);
    }));

    var userRoute = router.route('/users/:id');

    userRoute.get(h.wrap(function (req, res) {
        return h.getOneHandler(User, 'User', req, res);
    }));

    userRoute.put(h.wrap(async function (req, res) {
        var user = h.isValidId(req.params.id) ? await User.findById(req.params.id) : null;
        if (!user) throw new ApiError(404, 'User not found');

        var fields = parseUserBody(req.body);
        await checkUserReferences(fields, user._id);

        user.name = fields.name;
        user.email = fields.email;
        user.pendingTasks = fields.pendingTasks;
        await user.save();
        await syncUserTasks(user);

        h.send(res, 200, 'User updated', user);
    }));

    userRoute.delete(h.wrap(async function (req, res) {
        var user = h.isValidId(req.params.id) ? await User.findById(req.params.id) : null;
        if (!user) throw new ApiError(404, 'User not found');

        await User.deleteOne({ _id: user._id });
        await Task.updateMany(
            { assignedUser: user._id.toString() },
            { assignedUser: '', assignedUserName: 'unassigned' }
        );

        res.status(204).end();
    }));

    return router;
};
