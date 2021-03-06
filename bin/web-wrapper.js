#!/usr/bin/env node

// Imports.
// Library.
const generator = require('../lib/generator.js');

// Utils.
const ms = require('ms');

// Web server.
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const PORT = process.env.PORT || 4002;
const VALIDATION_LIMIT = ms('1d'); // 24h.
const SUCCESSIVE_ERRORS_REQUIRED = 5;

app.use(express.static(__dirname + '/../public'));

// Generation data.
const codePool = [];
const queue = [];
let surveying = false;

// Errors handling.
let stopped = false;
let successiveErrors = 0;

io.on('connection', socket => {
    socket.on('request', () => {
        if(stopped) {
            socket.emit('generation-error');
        } else {
            askCode(socket);
        }
    });

    socket.on('disconnect', () => {
        const placeInQueue = queue.indexOf(socket);
        if(~placeInQueue) {
            queue.splice(placeInQueue, 1);
            sendQueueUpdate();
        }
    });
});

function askCode(socket) {
    // Unstack codes if any and still valid.
    while(codePool.length > 0) {
        const code = codePool.shift();
        if(Date.now() < code.creation + VALIDATION_LIMIT) {
            socket.emit('code', code);
            return;
        }
    }

    // Otherwise queue the client and start generating a new code.
    queue.push(socket);
    socket.emit('queue', { position: queue.length });
    generateCode();
}

function generateCode() {
    // Cancel if already running a survey.
    if(surveying) return;

    surveying = true;

    function continueIfNeeded() {
        // Set state to ready.
        surveying = false;
        // Generate another code if needed.
        if(queue.length) {
            sendQueueUpdate();
            setTimeout(generateCode, 500);
        }
    }

    generator.generateCode()
    .then(code => {
        // Send code to the first person in queue, otherwise put it in the pool.
        codeGenerated({ code: code, creation: Date.now() });
        continueIfNeeded();
    })
    .catch(() => {
        codeGenerationFailed();
        continueIfNeeded();
    });
}

function codeGenerated(code) {
    successiveErrors = 0;
    // If someone is waiting for a code, send it to him.
    // Otherwise put it in the pool.
    if(queue.length) {
        const socket = queue.shift();
        socket.emit('code', code);
    } else {
        codePool.push(code);
    }
}

function codeGenerationFailed() {
    if(queue.length) queue.shift().emit('generation-error');
    stopped = (++successiveErrors >= SUCCESSIVE_ERRORS_REQUIRED);
}

function sendQueueUpdate() {
    queue.forEach((socket, index) => {
        socket.emit('queue', { position: index + 1 });
    });
}

server.listen(PORT, console.log.bind(null, `bk-generator started on port ${PORT}.`));
