var User = require('../models/user.js');
var Task = require('../models/task.js');
var h = require('./helpers.js');

var ApiError = h.ApiError;

function parseDeadline(value) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
    if (!(typeof value === 'number' || h.isNonEmptyString(value))) return null;
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

// Check the request body (400 errors only); returns the cleaned fields
function parseTaskBody(body) {
    body = body || {};
    if (!h.isNonEmptyString(body.name)) throw new ApiError(400, 'Task name is required');

    if (body.deadline === undefined || body.deadline === null || body.deadline === '') {
        throw new ApiError(400, 'Task deadline is required');
    }
    var deadline = parseDeadline(body.deadline);
    if (!deadline) throw new ApiError(400, 'Task deadline must be a valid date');

    var description = body.description;
    if (description === undefined || description === null) description = '';
    if (typeof description !== 'string') throw new ApiError(400, 'Task description must be a string');

    var completed = body.completed;
    if (completed === undefined || completed === null || completed === '') completed = false;
    if (completed === 'true') completed = true;
    if (completed === 'false') completed = false;
    if (typeof completed !== 'boolean') throw new ApiError(400, 'completed must be true or false');

    var assignedUser = body.assignedUser;
    if (assignedUser === undefined || assignedUser === null) assignedUser = '';
    if (typeof assignedUser !== 'string') throw new ApiError(400, 'assignedUser must be a user id');
    if (assignedUser !== '' && !h.isValidId(assignedUser)) throw new ApiError(400, 'assignedUser is not a valid user id');

    var assignedUserName = body.assignedUserName;
    if (assignedUserName === null || assignedUserName === '') assignedUserName = undefined;
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        throw new ApiError(400, 'assignedUserName must be a string');
    }
    if (assignedUser === '') {
        if (assignedUserName !== undefined && assignedUserName !== 'unassigned') {
            throw new ApiError(400, 'assignedUserName must be "unassigned" when no user is assigned');
        }
        assignedUserName = 'unassigned';
    }

    return {
        name: body.name,
        description: description,
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

// Checks that need the database: the assigned user must exist and match the name
async function checkTaskReferences(fields) {
    if (fields.assignedUser === '') return;
    var user = await User.findById(fields.assignedUser);
    if (!user) throw new ApiError(404, 'Assigned user does not exist');
    if (fields.assignedUserName === undefined) {
        fields.assignedUserName = user.name;
    } else if (fields.assignedUserName !== user.name) {
        throw new ApiError(400, 'assignedUserName does not match the name of the assigned user');
    }
}

// Make users' pendingTasks agree with the task
async function syncTaskUsers(task) {
    var taskId = task._id.toString();
    var keepInPending = task.assignedUser !== '' && !task.completed;

    // Any other user (e.g. the previous assignee) loses the task
    var others = keepInPending ? { _id: { $ne: task.assignedUser }, pendingTasks: taskId } : { pendingTasks: taskId };
    await User.updateMany(others, { $pull: { pendingTasks: taskId } });

    if (keepInPending) {
        await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: taskId } });
    }
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    tasksRoute.get(h.wrap(function (req, res) {
        return h.listHandler(Task, 100, req, res);
    }));

    tasksRoute.post(h.wrap(async function (req, res) {
        var fields = parseTaskBody(req.body);
        await checkTaskReferences(fields);

        var task = new Task(fields);
        await task.save();
        await syncTaskUsers(task);

        h.send(res, 201, 'Task created', task);
    }));

    var taskRoute = router.route('/tasks/:id');

    taskRoute.get(h.wrap(function (req, res) {
        return h.getOneHandler(Task, 'Task', req, res);
    }));

    taskRoute.put(h.wrap(async function (req, res) {
        var task = h.isValidId(req.params.id) ? await Task.findById(req.params.id) : null;
        if (!task) throw new ApiError(404, 'Task not found');

        var fields = parseTaskBody(req.body);
        await checkTaskReferences(fields);

        task.set(fields);
        await task.save();
        await syncTaskUsers(task);

        h.send(res, 200, 'Task updated', task);
    }));

    taskRoute.delete(h.wrap(async function (req, res) {
        var task = h.isValidId(req.params.id) ? await Task.findById(req.params.id) : null;
        if (!task) throw new ApiError(404, 'Task not found');

        await Task.deleteOne({ _id: task._id });
        var taskId = task._id.toString();
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } });

        res.status(204).end();
    }));

    return router;
};
