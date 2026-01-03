const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    message: { type: String },
    fileUrl: { type: String },
    type: { type: String, default: 'text' },
    timestamp: { type: Date, default: Date.now },
    // Naya Field: Kab delete hona hai (null matlab kabhi nahi)
    expiresAt: { type: Date, default: null } 
});

module.exports = mongoose.model('Message', messageSchema);