/**
 * WHATSAPP REAL - Servidor Principal
 * Aplicación de mensajería en tiempo real con Node.js, Express y Socket.io
 */

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

// Inicializar Express y Socket.io
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuración del puerto
const PORT = process.env.PORT || 3000;

// Middleware para servir archivos estáticos
app.use(express.static(path.join(__dirname, "../client")));
app.use(express.json());

// Rutas de archivos de datos
const DATA_DIR = path.join(__dirname, "../data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");

// Almacenamiento en memoria de usuarios conectados
let connectedUsers = {};
let activeRooms = {};

// ============================================
// FUNCIONES DE GESTIÓN DE ARCHIVOS
// ============================================

/**
 * Crear archivos de datos si no existen
 */
function initializeDataFiles() {
  // Crear directorio de datos si no existe
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Inicializar archivo de usuarios
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }

  // Inicializar archivo de mensajes
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
  }

  // Inicializar archivo de grupos
  if (!fs.existsSync(GROUPS_FILE)) {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify([], null, 2));
  }
}

/**
 * Leer usuarios desde archivo
 */
function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error al leer usuarios:", error);
    return [];
  }
}

/**
 * Guardar usuarios en archivo
 */
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error("Error al guardar usuarios:", error);
  }
}

/**
 * Leer mensajes desde archivo
 */
function readMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error al leer mensajes:", error);
    return [];
  }
}

/**
 * Guardar mensajes en archivo
 */
function saveMessages(messages) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error("Error al guardar mensajes:", error);
  }
}

/**
 * Leer grupos desde archivo
 */
function readGroups() {
  try {
    const data = fs.readFileSync(GROUPS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error al leer grupos:", error);
    return [];
  }
}

/**
 * Guardar grupos en archivo
 */
function saveGroups(groups) {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
  } catch (error) {
    console.error("Error al guardar grupos:", error);
  }
}

// ============================================
// RUTAS HTTP
// ============================================

// Ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Ruta para obtener usuarios registrados
app.get("/api/users", (req, res) => {
  const users = readUsers();
  res.json(users);
});

// Ruta para obtener grupos
app.get("/api/groups", (req, res) => {
  const groups = readGroups();
  res.json(groups);
});

// Ruta para obtener mensajes de un chat específico
app.get("/api/messages/:chatId", (req, res) => {
  const { chatId } = req.params;
  const { currentUser } = req.query;
  const messages = readMessages();

  // Filtrar mensajes solo entre el usuario actual y el contacto específico
  const chatMessages = messages.filter((msg) => {
    // Si es un grupo
    if (msg.type === "group" && msg.groupId === chatId) {
      return true;
    }

    // Si es mensaje privado, debe ser entre estos dos usuarios específicamente
    if (msg.type === "private" && currentUser) {
      // Comparación case-insensitive
      const fromUsername = (msg.fromUsername || "").toLowerCase();
      const toUsername = (msg.to || "").toLowerCase();
      const currentUserLower = currentUser.toLowerCase();
      const chatIdLower = chatId.toLowerCase();
      return (
        (fromUsername === currentUserLower && toUsername === chatIdLower) ||
        (fromUsername === chatIdLower && toUsername === currentUserLower)
      );
    }

    return false;
  });

  res.json(chatMessages);
});

// API: Obtener todos los mensajes de un usuario (para cargar chats al iniciar sesión)
app.get("/api/user-messages/:username", (req, res) => {
  const { username } = req.params;
  const messages = readMessages();

  console.log(`📥 Solicitando mensajes para usuario: ${username}`);

  // Filtrar todos los mensajes donde el usuario es emisor o receptor
  const userMessages = messages.filter((msg) => {
    if (msg.type === "private") {
      // Comparación case-insensitive
      const fromUsername = (msg.fromUsername || "").toLowerCase();
      const toUsername = (msg.to || "").toLowerCase();
      const searchUsername = username.toLowerCase();
      const match =
        fromUsername === searchUsername || toUsername === searchUsername;

      if (match) {
        console.log(
          `  ✅ Mensaje incluido: ${msg.fromUsername} → ${
            msg.to
          }: "${msg.message.substring(0, 30)}"`
        );
      }

      return match;
    }
    return false;
  });

  // Ordenar por timestamp (más reciente primero)
  userMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  console.log(
    `📥 Total de mensajes encontrados para ${username}: ${userMessages.length}`
  );

  res.json(userMessages);
});

// ============================================
// EVENTOS DE SOCKET.IO
// ============================================

io.on("connection", (socket) => {
  console.log("🔌 Nuevo cliente conectado:", socket.id);

  /**
   * Evento: REGISTRO DE NUEVO USUARIO
   */
  socket.on("register-user", (userData) => {
    const { username, password, avatar } = userData;

    let users = readUsers();

    // Verificar si el usuario ya existe
    const existingUser = users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );

    if (existingUser) {
      socket.emit("register-response", {
        success: false,
        message: "El nombre de usuario ya está en uso",
      });
      return;
    }

    // Crear nuevo usuario
    const newUser = {
      username: username,
      password: password,
      avatar: avatar || "👤",
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers(users);

    socket.emit("register-response", {
      success: true,
      message: "Usuario registrado exitosamente",
    });

    console.log(`✅ Usuario registrado: ${username}`);
  });

  /**
   * Evento: LOGIN DE USUARIO
   */
  socket.on("login-user", (credentials) => {
    const { username, password } = credentials;

    let users = readUsers();

    // Buscar usuario
    const user = users.find(
      (u) =>
        u.username.toLowerCase() === username.toLowerCase() &&
        u.password === password
    );

    if (user) {
      socket.emit("login-response", {
        success: true,
        username: user.username,
        avatar: user.avatar,
        message: "Login exitoso",
      });
      console.log(`✅ Login exitoso: ${username}`);
    } else {
      socket.emit("login-response", {
        success: false,
        message: "Usuario o contraseña incorrectos",
      });
      console.log(`❌ Login fallido: ${username}`);
    }
  });

  /**
   * Evento: REGISTRAR CONEXIÓN ACTIVA
   */
  socket.on("register", (userData) => {
    const { username, avatar } = userData;

    // Verificar si el usuario ya está conectado desde otro socket
    const existingSocketId = Object.keys(connectedUsers).find(
      (sid) => connectedUsers[sid].username === username
    );

    // Si existe, eliminar la conexión anterior
    if (existingSocketId && existingSocketId !== socket.id) {
      delete connectedUsers[existingSocketId];
    }

    // Guardar información del usuario conectado
    connectedUsers[socket.id] = {
      id: socket.id,
      username: username,
      avatar: avatar || "👤",
      online: true,
      lastSeen: new Date().toISOString(),
    };

    // Guardar en archivo de usuarios (sin duplicados)
    let users = readUsers();
    const existingUserIndex = users.findIndex((u) => u.username === username);

    if (existingUserIndex !== -1) {
      users[existingUserIndex].online = true;
      users[existingUserIndex].socketId = socket.id;
      users[existingUserIndex].lastSeen = new Date().toISOString();
      users[existingUserIndex].avatar = avatar || "👤";
    } else {
      users.push({
        username: username,
        avatar: avatar || "👤",
        socketId: socket.id,
        online: true,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    saveUsers(users);

    // Notificar al usuario que se registró correctamente
    socket.emit("registered", {
      success: true,
      user: connectedUsers[socket.id],
    });

    // Enviar lista de TODOS los usuarios conectados (de connectedUsers en memoria)
    // Filtrar para no incluir al usuario actual
    const allConnectedUsers = Object.values(connectedUsers)
      .filter((u) => u.username !== username)
      .map((u) => ({
        ...u,
        online: true,
      }));

    socket.emit("users-list", allConnectedUsers);

    // Notificar a todos los DEMÁS usuarios sobre el usuario conectado
    socket.broadcast.emit("user-connected", connectedUsers[socket.id]);

    console.log(`✅ Usuario registrado: ${username} (${socket.id})`);
  });

  /**
   * Evento: OBTENER LISTA DE USUARIOS
   */
  socket.on("get-users", () => {
    const users = readUsers();
    socket.emit("users-list", users);
  });

  /**
   * Evento: MENSAJE PRIVADO
   * Enviar mensaje a un usuario específico
   */
  socket.on("private-message", (data) => {
    const { to, message, from, fromUsername } = data;

    // Crear objeto de mensaje
    const messageData = {
      id: Date.now().toString(),
      from: from,
      fromUsername: fromUsername,
      to: to,
      message: message,
      timestamp: new Date().toISOString(),
      type: "private",
      read: false,
    };

    // Guardar mensaje en archivo
    let messages = readMessages();
    messages.push(messageData);
    saveMessages(messages);

    // Buscar el socket del destinatario (case-insensitive)
    const recipientSocketId = Object.keys(connectedUsers).find(
      (key) => connectedUsers[key].username.toLowerCase() === to.toLowerCase()
    );

    // Enviar mensaje al destinatario si está conectado
    if (recipientSocketId) {
      console.log(`✅ Enviando mensaje a ${to} (socket: ${recipientSocketId})`);
      io.to(recipientSocketId).emit("receive-message", messageData);
    } else {
      console.log(`⚠️ Usuario ${to} no está conectado, mensaje guardado`);
    }

    // Confirmar al remitente
    socket.emit("message-sent", messageData);

    console.log(`📨 Mensaje privado guardado: ${fromUsername} → ${to}`);
  });

  /**
   * Evento: CREAR GRUPO
   */
  socket.on("create-group", (data) => {
    const { groupName, members, creator } = data;

    const groupId = `group_${Date.now()}`;
    const newGroup = {
      id: groupId,
      name: groupName,
      members: members,
      creator: creator,
      createdAt: new Date().toISOString(),
      avatar: "👥",
    };

    // Guardar grupo
    let groups = readGroups();
    groups.push(newGroup);
    saveGroups(groups);

    // Crear sala para el grupo
    activeRooms[groupId] = {
      name: groupName,
      members: members,
      messages: [],
    };

    // Unir al creador a la sala del grupo
    socket.join(groupId);

    // Notificar al creador
    socket.emit("group-created", newGroup);

    // Notificar a todos los miembros sobre el nuevo grupo (case-insensitive)
    members.forEach((member) => {
      const memberSocketId = Object.keys(connectedUsers).find(
        (key) =>
          connectedUsers[key].username.toLowerCase() === member.toLowerCase()
      );
      if (memberSocketId) {
        // Unir al miembro a la sala del grupo
        io.sockets.sockets.get(memberSocketId).join(groupId);
        // Notificar al miembro
        io.to(memberSocketId).emit("new-group", newGroup);
        console.log(`✅ Miembro ${member} añadido al grupo ${groupName}`);
      }
    });

    console.log(`👥 Grupo creado: ${groupName} por ${creator}`);
  });

  /**
   * Evento: UNIRSE A GRUPO
   */
  socket.on("join-group", (groupId) => {
    socket.join(groupId);
    console.log(`Usuario ${socket.id} se unió al grupo ${groupId}`);
  });

  /**
   * Evento: MENSAJE GRUPAL
   */
  socket.on("group-message", (data) => {
    const { groupId, message, from, fromUsername } = data;

    const messageData = {
      id: Date.now().toString(),
      groupId: groupId,
      from: from,
      fromUsername: fromUsername,
      message: message,
      timestamp: new Date().toISOString(),
      type: "group",
    };

    // Guardar mensaje
    let messages = readMessages();
    messages.push(messageData);
    saveMessages(messages);

    // Enviar mensaje a todos los miembros del grupo EXCEPTO al emisor
    socket.broadcast.to(groupId).emit("receive-group-message", messageData);

    // Enviar mensaje de vuelta al emisor UNA SOLA VEZ
    socket.emit("receive-group-message", messageData);

    console.log(`📨 Mensaje grupal en ${groupId}: ${fromUsername}`);
  });

  /**
   * Evento: USUARIO ESCRIBIENDO
   */
  socket.on("typing", (data) => {
    const { to, from, isGroup } = data;

    if (isGroup) {
      socket.to(to).emit("user-typing", { from, isGroup: true });
    } else {
      const recipientSocketId = Object.keys(connectedUsers).find(
        (key) => connectedUsers[key].username === to
      );
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("user-typing", { from });
      }
    }
  });

  /**
   * Evento: DEJAR DE ESCRIBIR
   */
  socket.on("stop-typing", (data) => {
    const { to, from, isGroup } = data;

    if (isGroup) {
      socket.to(to).emit("user-stop-typing", { from });
    } else {
      const recipientSocketId = Object.keys(connectedUsers).find(
        (key) => connectedUsers[key].username === to
      );
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("user-stop-typing", { from });
      }
    }
  });

  /**
   * Evento: DESCONEXIÓN
   */
  socket.on("disconnect", () => {
    const user = connectedUsers[socket.id];

    if (user) {
      // Actualizar estado del usuario
      let users = readUsers();
      const userIndex = users.findIndex((u) => u.username === user.username);

      if (userIndex !== -1) {
        users[userIndex].online = false;
        users[userIndex].lastSeen = new Date().toISOString();
        saveUsers(users);
      }

      // Notificar a todos sobre la desconexión
      io.emit("user-disconnected", {
        username: user.username,
        lastSeen: new Date().toISOString(),
      });

      console.log(`❌ Usuario desconectado: ${user.username} (${socket.id})`);

      // Eliminar del almacenamiento en memoria
      delete connectedUsers[socket.id];
    } else {
      console.log("❌ Cliente desconectado:", socket.id);
    }
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

// Inicializar archivos de datos
initializeDataFiles();

// Iniciar servidor
server.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("🚀 kios Chat - Servidor Iniciado");
  console.log("=".repeat(60));
  // console.log(`📡 Servidor corriendo en: http://localhost:${PORT}`);
  // console.log(`🌐 Acceso desde red: http://<tu-ip>:${PORT}`);
  // console.log("=".repeat(60));
  // console.log("💡 Presiona Ctrl+C para detener el servidor");
  // console.log("=".repeat(60));
});

// Manejo de errores
process.on("uncaughtException", (error) => {
  console.error("❌ Error no capturado:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Promesa rechazada no manejada:", reason);
});
