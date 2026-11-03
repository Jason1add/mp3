// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    pendingTasks: { type: [String], default: [] }
}, {
    // dateCreated is set by the server on creation and never changes
    timestamps: { createdAt: 'dateCreated', updatedAt: false },
    versionKey: false
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
