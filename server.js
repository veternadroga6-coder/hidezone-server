const express = require('express');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

// Haversine formula for distance calculation (meters)
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createRoom', ({ roomId, roomPassword, playerName, customSettings }) => {
    rooms[roomId] = {
      password: roomPassword,
      gameState: 'LOBBY',
      players: {},
      zoneCenter: null,
      currentRadius: customSettings?.initialRadiusMeters || 500,
      gameDurationMinutes: customSettings?.gameDurationMinutes || 15,
      timer: null
    };

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      role: 'seeker',
      lat: null,
      lng: null
    };

    socket.join(roomId);
    io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
    console.log(`Room created: ${roomId} by ${playerName}`);
  });

  socket.on('joinRoom', ({ roomId, roomPassword, playerName, role }) => {
    if (!rooms[roomId]) {
      return socket.emit('errorMsg', 'Room does not exist!');
    }
    if (rooms[roomId].password !== roomPassword) {
      return socket.emit('errorMsg', 'Incorrect room password!');
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      role: role || 'hider',
      lat: null,
      lng: null
    };

    socket.join(roomId);
    io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
    console.log(`${playerName} joined room ${roomId}`);
  });

  socket.on('changeRole', ({ roomId, role }) => {
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id].role = role;
      io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
    }
  });

  socket.on('updateSettings', ({ roomId, customSettings }) => {
    if (rooms[roomId]) {
      rooms[roomId].currentRadius = customSettings.initialRadiusMeters;
      rooms[roomId].gameDurationMinutes = customSettings.gameDurationMinutes;
      io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
    }
  });

  socket.on('updateLocation', ({ roomId, lat, lng }) => {
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      const player = rooms[roomId].players[socket.id];
      player.lat = lat;
      player.lng = lng;

      io.to(roomId).emit('playersUpdate', {
        players: rooms[roomId].players,
        currentRadius: rooms[roomId].currentRadius,
        zoneCenter: rooms[roomId].zoneCenter
      });
    }
  });

  socket.on('startGame', ({ roomId, centerLat, centerLng }) => {
    if (!rooms[roomId]) return;
    
    rooms[roomId].gameState = 'PLAYING';
    rooms[roomId].zoneCenter = { lat: centerLat, lng: centerLng };
    
    let timeRemaining = rooms[roomId].gameDurationMinutes * 60;
    io.to(roomId).emit('roomStateUpdate', rooms[roomId]);

    if (rooms[roomId].timer) clearInterval(rooms[roomId].timer);

    rooms[roomId].timer = setInterval(() => {
      timeRemaining--;
      io.to(roomId).emit('timerTick', { timeRemaining });

      if (timeRemaining <= 0) {
        clearInterval(rooms[roomId].timer);
        rooms[roomId].gameState = 'ENDED';
        io.to(roomId).emit('gameOver', { winner: 'Hiders Won (Time Expired!)' });
      }
    }, 1000);
  });

  socket.on('selfTagged', ({ roomId }) => {
    if (rooms[roomId]) {
      if (rooms[roomId].players[socket.id]) {
        rooms[roomId].players[socket.id].role = 'seeker'; // Turn tagged hider into a seeker
      }
      io.to(roomId).emit('playerTagged', { message: `${rooms[roomId].players[socket.id]?.name} has been tagged and is now a Seeker!` });
      io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
        break;
      }
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HideZone server running on port ${PORT}`);
});
