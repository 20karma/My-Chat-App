const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static('public'));

// --- FILE UPLOAD ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => cb(null, "FILE-" + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- DATABASE ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/secretChat';
mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Connected!")).catch(e => console.log(e));

// --- AUTO-DELETE CLEANER ---
setInterval(async () => {
    try { await Message.deleteMany({ expiresAt: { $ne: null, $lt: new Date() } }); } 
    catch (e) { console.log(e); }
}, 60000); 

// --- ROUTES ---
app.post('/upload', upload.single('myFile'), (req, res) => {
    if(req.file) res.json({ success: true, url: '/uploads/' + req.file.filename });
    else res.json({ success: false });
});

app.post('/update-profile', upload.single('profilePic'), async (req, res) => {
    try {
        const { username, bio } = req.body;
        let updateData = { bio };
        if (req.file) updateData.profilePic = '/uploads/' + req.file.filename;
        await User.findOneAndUpdate({ username }, updateData);
        res.json({ success: true, ...updateData });
    } catch (e) { res.json({ success: false }); }
});

app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (await User.findOne({ username: { $regex: new RegExp("^" + username + "$", "i") } })) 
            return res.json({ success: false, msg: "ID Taken!" });
        await new User({ username, password }).save();
        res.json({ success: true, msg: "Registered!" });
    } catch (e) { res.json({ success: false }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (user) res.json({ success: true, username: user.username, pic: user.profilePic, bio: user.bio });
        else res.json({ success: false, msg: "Wrong ID/Pass" });
    } catch (e) { res.json({ success: false }); }
});

app.get('/search-user', async (req, res) => {
    try {
        const user = await User.findOne({ username: { $regex: new RegExp("^" + req.query.q + "$", "i") } });
        if(user) res.json({ success: true, foundUser: user.username, pic: user.profilePic, bio: user.bio });
        else res.json({ success: false });
    } catch (e) { res.json({ success: false }); }
});

app.get('/get-messages', async (req, res) => {
    const { user1, user2 } = req.query;
    const msgs = await Message.find({
        $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
    }).sort({ timestamp: 1 });
    res.json(msgs);
});

// --- SOCKET ---
io.on('connection', (socket) => {
    socket.on('join', (id) => socket.join(id));
    
    socket.on('privateMessage', async (data) => {
        let expireDate = null;
        if (data.timer === '24h') expireDate = new Date(Date.now() + 24*60*60*1000);
        if (data.timer === '7d') expireDate = new Date(Date.now() + 7*24*60*60*1000);

        const newMsg = new Message({ 
            sender: data.sender, receiver: data.receiver, 
            message: data.msg, fileUrl: data.fileUrl, type: data.type,
            expiresAt: expireDate
        });
        const savedMsg = await newMsg.save();
        const payload = { ...data, _id: savedMsg._id };
        
        io.to(data.receiver).emit('receiveMessage', payload);
        io.to(data.sender).emit('receiveMessage', payload);
    });

    socket.on('deleteForEveryone', async (data) => {
        await Message.findByIdAndDelete(data.msgId);
        io.to(data.receiver).emit('messageDeleted', data.msgId);
        io.to(data.sender).emit('messageDeleted', data.msgId);
    });

    // 🔥 NEW: CLEAR ALL CHAT 🔥
    socket.on('clearChat', async (data) => {
        // Delete ALL messages between these two users
        await Message.deleteMany({
            $or: [
                { sender: data.sender, receiver: data.receiver },
                { sender: data.receiver, receiver: data.sender }
            ]
        });
        // Notify both users
        io.to(data.receiver).emit('chatCleared');
        io.to(data.sender).emit('chatCleared');
    });

    // Other Events
    socket.on('gameMove', (d) => io.to(d.receiver).emit('gameMove', d));
    socket.on('gameReset', (d) => io.to(d.receiver).emit('gameReset', d));
    socket.on('callUser', (d) => io.to(d.userToCall).emit('callUser', { signal: d.signalData, from: d.from }));
    socket.on('answerCall', (d) => io.to(d.to).emit('callAccepted', d.signal));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log("Server Running..."));