/**
 * kios REAL - Cliente JavaScript
 * Manejo de Socket.io y toda la lógica del cliente
 */

// ============================================
// VARIABLES GLOBALES
// ============================================

const kiosNotification = document.getElementById("kiosNotification");
// Función para mostrar notificaciones
function showKiosNotification(message, duration = 3000) {
  kiosNotification.innerHTML = "";
  kiosNotification.innerHTML = "<strong> 🔔" + message + "</strong>";
  kiosNotification.classList.add("show");

  setTimeout(() => {
    kiosNotification.classList.remove("show");
  }, duration);
}

function showKiosNotificationConfirm(message) {
  return new Promise((resolve) => {
    kiosNotification.innerHTML = `
      <strong>❗ ${message}</strong>
      <button id="confirmButton" class="btn-send" style="margin-left: 20px">✓</button>
    `;

    kiosNotification.classList.add("show");

    // Botón confirmar
    document.getElementById("confirmButton").addEventListener("click", () => {
      kiosNotification.classList.remove("show");
      resolve(true); // 👍 usuario confirmó
    });

    // Cierre automático a los 5 segundos
    setTimeout(() => {
      kiosNotification.classList.remove("show");
      resolve(false); // Si no hace nada = cancelar
    }, 5000);
  });
}

let socket;
let currentUser = {
  username: "",
  avatar: "",
  socketId: "",
};
let currentChat = null;
let allUsers = [];
let allGroups = [];
let userChats = new Map();
let typingTimeout;
let deletedChats = new Set();
let archivedChats = new Set();

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener("DOMContentLoaded", () => {
  // Verificar si el usuario está logueado (usando sessionStorage)
  const savedUsername = sessionStorage.getItem("kios_username");
  const savedAvatar = sessionStorage.getItem("kios_avatar");

  // showKiosNotification('Iniciaste sesión como  "' + savedUsername + '"');
  showKiosNotification('Iniciaste sesión como  "' + savedUsername + '"');

  if (!savedUsername || !savedAvatar) {
    window.location.href = "index.html";
    return;
  }

  // Establecer usuario actual
  currentUser.username = savedUsername;
  currentUser.avatar = savedAvatar;

  // Cargar chats eliminados y archivados desde localStorage
  loadDeletedChats();

  // Actualizar UI con datos del usuario
  document.getElementById("currentUserName").textContent = savedUsername;
  document.getElementById("currentUserAvatar").textContent = savedAvatar;

  // Conectar a Socket.io
  initializeSocket();

  // Inicializar event listeners
  initializeEventListeners();
});

// ============================================
// SOCKET.IO
// ============================================

/**
 * Inicializar conexión Socket.io
 */
function initializeSocket() {
  socket = io();

  // Registrar usuario
  socket.emit("register", {
    username: currentUser.username,
    avatar: currentUser.avatar,
  });

  // Evento: Usuario registrado correctamente
  socket.on("registered", (data) => {
    if (data.success) {
      currentUser.socketId = socket.id;
      console.log("✅ Registrado correctamente:", data.user);
      // Cargar chats anteriores al iniciar sesión
      loadPreviousChats();
    }
  });

  // Evento: Lista de usuarios
  socket.on("users-list", (users) => {
    allUsers = users.filter((u) => u.username !== currentUser.username);
    updateOnlineUsersList();
  });

  // Evento: Usuario conectado
  socket.on("user-connected", (user) => {
    if (user.username !== currentUser.username) {
      allUsers.push(user);
      updateOnlineUsersList();
      showNotification(`${user.username} se conectó`);
    }
  });

  // Evento: Usuario desconectado
  socket.on("user-disconnected", (data) => {
    allUsers = allUsers.filter((u) => u.username !== data.username);
    updateOnlineUsersList();
    // updateChatStatus(data.username, false, data.lastSeen);
  });

  // Evento: Recibir mensaje privado
  socket.on("receive-message", (messageData) => {
    handleReceivedMessage(messageData);
  });

  // Evento: Mensaje enviado confirmado
  socket.on("message-sent", (messageData) => {
    // Ya se muestra en la UI al enviar
    console.log("✅ Mensaje enviado:", messageData);
  });

  // Evento: Nuevo grupo creado
  socket.on("new-group", (group) => {
    console.log("👥 Nuevo grupo recibido:", group);
    allGroups.push(group);

    // Unirse automáticamente al grupo
    socket.emit("join-group", group.id);

    addChatToList(group, true);
    showNotification(`Te agregaron al grupo: ${group.name}`);

    // Guardar grupo en localStorage
    saveGroupToLocalStorage(group);
  });

  // Evento: Grupo creado por ti
  socket.on("group-created", (group) => {
    console.log("👥 Grupo creado por ti:", group);
    allGroups.push(group);

    // Unirse automáticamente al grupo
    socket.emit("join-group", group.id);

    addChatToList(group, true);
    showNotification(`Grupo "${group.name}" creado exitosamente`);
    closeGroupModal();

    // Guardar grupo en localStorage
    saveGroupToLocalStorage(group);
  });

  // Evento: Recibir mensaje grupal
  socket.on("receive-group-message", (messageData) => {
    handleReceivedGroupMessage(messageData);
  });

  // Evento: Usuario escribiendo
  socket.on("user-typing", (data) => {
    if (currentChat && currentChat.username === data.from) {
      showTypingIndicator(true);
    }
  });

  // Evento: Usuario dejó de escribir
  socket.on("user-stop-typing", (data) => {
    if (currentChat && currentChat.username === data.from) {
      showTypingIndicator(false);
    }
  });

  // Solicitar lista de usuarios
  socket.emit("get-users");
}

// ============================================
// EVENT LISTENERS
// ============================================

/**
 * Inicializar todos los event listeners
 */
function initializeEventListeners() {
  // Botón de logout
  document.getElementById("logoutBtn").addEventListener("click", logout);

  // Botón de nuevo grupo
  document
    .getElementById("newGroupBtn")
    .addEventListener("click", openGroupModal);

  // Cerrar modal de grupo
  document
    .getElementById("closeGroupModal")
    .addEventListener("click", closeGroupModal);
  document
    .getElementById("cancelGroupBtn")
    .addEventListener("click", closeGroupModal);

  // Crear grupo
  document
    .getElementById("createGroupBtn")
    .addEventListener("click", createGroup);

  // Enviar mensaje
  document.getElementById("sendBtn").addEventListener("click", sendMessage);
  document.getElementById("messageInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  });

  // Detectar cuando el usuario está escribiendo
  document.getElementById("messageInput").addEventListener("input", () => {
    if (currentChat) {
      socket.emit("typing", {
        to: currentChat.isGroup ? currentChat.id : currentChat.username,
        from: currentUser.username,
        isGroup: currentChat.isGroup || false,
      });

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit("stop-typing", {
          to: currentChat.isGroup ? currentChat.id : currentChat.username,
          from: currentUser.username,
          isGroup: currentChat.isGroup || false,
        });
      }, 2000);
    }
  });

  // Búsqueda de chats
  document.getElementById("searchInput").addEventListener("input", (e) => {
    filterChats(e.target.value);
  });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Cargar todos los contactos al inicio
  loadAllContacts();
}

// ============================================
// UI - LISTA DE USUARIOS
// ============================================

/**
 * Actualizar lista de usuarios en línea
 */
function updateOnlineUsersList() {
  const container = document.getElementById("allContactsList");
  if (!container) return;

  container.innerHTML = "";

  if (allUsers.length === 0) {
    container.innerHTML =
      '<p style="color: var(--text-secondary); font-size: 13px; padding: 20px; text-align: center;">No hay contactos disponibles</p>';
    return;
  }

  allUsers.forEach((user) => {
    const userElement = createUserElement(user);
    container.appendChild(userElement);
  });
}

/**
 * Crear elemento de usuario
 */
function createUserElement(user) {
  const div = document.createElement("div");
  div.className = "user-item";

  div.innerHTML = `
        <span class="user-item-avatar">${user.avatar || "👤"}</span>
        <span class="user-item-name">${user.username}</span>
        `;

  // ${user.online ? '<span class="online-indicator"></span>' : ""}
  // Agregar event listener para hacer clic
  div.addEventListener("click", () => startChatWithUser(user));

  return div;
}

// ============================================
// UI - LISTA DE CHATS
// ============================================

/**
 * Agregar chat a la lista
 */
function addChatToList(
  chatData,
  isGroup = false,
  lastMessage = null,
  timestamp = null
) {
  const chatsList = document.getElementById("chatsList");

  const chatId = chatData.id || chatData.username;

  // Verificar si el chat está eliminado o archivado
  if (deletedChats.has(chatId) || archivedChats.has(chatId)) {
    console.log(`Chat ${chatId} está eliminado o archivado, no se mostrará`);
    return;
  }

  // Verificar si ya existe
  const existingChat = document.getElementById(`chat-${chatId}`);
  if (existingChat) return;

  const chatItem = document.createElement("div");
  chatItem.className = "chat-item";
  chatItem.id = `chat-${chatId}`;

  // Formatear tiempo si existe
  let timeString = "";
  if (timestamp) {
    const date = new Date(timestamp);
    timeString = date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Mensaje de preview
  const previewText =
    lastMessage || (isGroup ? "Grupo creado" : "Iniciar conversación");

  chatItem.innerHTML = `
        <div class="chat-item-clickable">
            <span class="chat-avatar">${chatData.avatar || "👤"}</span>
            <div class="chat-info-container">
                <div class="chat-item-header">
                    <span class="chat-item-name">${
                      chatData.name || chatData.username
                    }</span>
                    <span class="chat-item-time">${timeString}</span>
                </div>
                <div class="chat-item-preview">
                    ${previewText.substring(0, 30)}${
    previewText.length > 30 ? "..." : ""
  }
                </div>
            </div>
        </div>
        <button class="chat-menu-btn" onclick="toggleChatMenu(event, '${chatId}', ${isGroup})" title="Más opciones">⋮</button>
        <div class="chat-dropdown-menu" id="menu-${chatId}" style="display: none;">
            ${
              isGroup
                ? `<div class="menu-item" onclick="showGroupInfo('${chatData.id}', event)">ℹ️ Info del grupo</div>`
                : ""
            }
            <div class="menu-item delete" onclick="deleteChat('${chatId}', ${isGroup}, event)">🗑️ Eliminar chat</div>
        </div>
    `;

  // Agregar event listener para abrir el chat
  const clickableArea = chatItem.querySelector(".chat-item-clickable");
  clickableArea.addEventListener("click", () => {
    openChat(chatData, isGroup);
  });

  // Limpiar mensaje "No tienes conversaciones" si existe
  const emptyState = chatsList.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }

  chatsList.insertBefore(chatItem, chatsList.firstChild);
}

/**
 * Iniciar chat con un usuario
 */
function startChatWithUser(user) {
  // Verificar si ya existe el chat
  if (!document.getElementById(`chat-${user.username}`)) {
    addChatToList(user, false);
  }

  // Cambiar a la pestaña de chats
  switchTab("chats");

  // Abrir el chat
  openChat(user, false);
}

/**
 * Abrir chat
 */
function openChat(chatData, isGroup) {
  // Cerrar cualquier menú abierto
  document.querySelectorAll(".chat-dropdown-menu").forEach((menu) => {
    menu.style.display = "none";
  });

  // Actualizar chat actual
  currentChat = {
    ...chatData,
    isGroup: isGroup,
  };

  // Actualizar UI
  document.getElementById("noChatSelected").style.display = "none";
  const activeChat = document.getElementById("activeChat");
  activeChat.style.display = "flex";

  // Asegurar que el input de mensaje esté visible
  const messageInputContainer = activeChat.querySelector(
    ".message-input-container"
  );
  if (messageInputContainer) {
    messageInputContainer.style.display = "flex";
  }

  // Actualizar header del chat
  document.getElementById("chatAvatar").textContent = chatData.avatar || "👤";
  document.getElementById("chatName").textContent =
    chatData.name || chatData.username;
  // document.getElementById("chatStatus").textContent = isGroup
  //   ? `${chatData.members ? chatData.members.length : 0} miembros`
  //   : chatData.online
  //   ? "en línea"
  //   : "desconectado";

  // Marcar chat como activo en la lista
  document.querySelectorAll(".chat-item").forEach((item) => {
    item.classList.remove("active");
  });
  const chatElement = document.getElementById(
    `chat-${chatData.id || chatData.username}`
  );
  if (chatElement) {
    chatElement.classList.add("active");
  }

  // Cargar mensajes
  loadMessages(chatData, isGroup);

  // Si es grupo, unirse a la sala
  if (isGroup) {
    socket.emit("join-group", chatData.id);
  }
}

// ============================================
// MENSAJES
// ============================================

/**
 * Enviar mensaje
 */
function sendMessage() {
  const input = document.getElementById("messageInput");
  const message = input.value.trim();

  if (!message || !currentChat) return;

  const messageData = {
    from: currentUser.socketId,
    fromUsername: currentUser.username,
    message: message,
    timestamp: new Date().toISOString(),
  };

  if (currentChat.isGroup) {
    // Mensaje grupal
    socket.emit("group-message", {
      ...messageData,
      groupId: currentChat.id,
    });
    // NO mostramos el mensaje aquí, esperar a que el servidor lo retransmita
  } else {
    // Mensaje privado
    socket.emit("private-message", {
      ...messageData,
      to: currentChat.username,
    });
    // Mostrar mensaje en la UI solo para mensajes privados
    displayMessage(
      {
        ...messageData,
        fromUsername: currentUser.username,
      },
      true
    );

    // Asegurar que el chat esté en la lista
    if (!document.getElementById(`chat-${currentChat.username}`)) {
      addChatToList(currentChat, false, message, messageData.timestamp);
    } else {
      // Actualizar preview del chat
      updateChatPreview(currentChat.username, message);
    }
  }

  // Limpiar input
  input.value = "";

  // Detener indicador de escritura
  socket.emit("stop-typing", {
    to: currentChat.isGroup ? currentChat.id : currentChat.username,
    from: currentUser.username,
    isGroup: currentChat.isGroup || false,
  });
}

/**
 * Manejar mensaje recibido
 */
function handleReceivedMessage(messageData) {
  console.log("📨 Mensaje recibido:", messageData);

  // Buscar si el usuario ya está en la lista de chats
  const chatId = messageData.fromUsername;

  // IGNORAR mensajes de usuarios inválidos
  if (
    !chatId ||
    chatId === "undefined" ||
    chatId === "null" ||
    chatId.trim() === ""
  ) {
    console.log(`🚫 Mensaje de usuario inválido ignorado: "${chatId}"`);
    return;
  }

  // Si el chat estaba eliminado, quitarlo de eliminados (nuevo mensaje lo reactiva)
  if (deletedChats.has(chatId)) {
    console.log(`✅ Reactivando chat eliminado: ${chatId}`);
    deletedChats.delete(chatId);
    saveDeletedChats(); // Guardar cambios
  }

  let chatElement = document.getElementById(`chat-${chatId}`);

  // Si NO existe el chat, crearlo automáticamente
  if (!chatElement) {
    console.log("🆕 Creando chat nuevo para:", chatId);
    const senderUser = allUsers.find(
      (u) => u.username.toLowerCase() === messageData.fromUsername.toLowerCase()
    );
    if (senderUser) {
      addChatToList(
        senderUser,
        false,
        messageData.message,
        messageData.timestamp
      );
    } else {
      // Si no está en la lista de usuarios, crear uno temporal
      addChatToList(
        {
          username: messageData.fromUsername,
          avatar: "👤",
          online: false,
        },
        false,
        messageData.message,
        messageData.timestamp
      );
    }
    // Forzar cambio a la pestaña de Chats
    document
      .querySelectorAll(".tab-btn")
      .forEach((btn) => btn.classList.remove("active"));
    document
      .querySelector('.tab-btn[data-tab="chats"]')
      .classList.add("active");

    document.getElementById("chatsList").classList.remove("hidden");
    document.getElementById("contactsList").classList.add("hidden");

    // Actualizar el elemento del chat después de crearlo
    chatElement = document.getElementById(`chat-${chatId}`);
  }

  // Si es el chat actual, mostrar el mensaje
  if (
    currentChat &&
    currentChat.username.toLowerCase() ===
      messageData.fromUsername.toLowerCase()
  ) {
    displayMessage(messageData, false);
  }

  // Actualizar preview en la lista de chats
  updateChatPreview(
    messageData.fromUsername,
    messageData.message,
    null,
    messageData.timestamp
  );
}

/**
 * Manejar mensaje grupal recibido
 */
function handleReceivedGroupMessage(messageData) {
  console.log("📨 Mensaje grupal recibido:", messageData);
  const groupId = messageData.groupId;

  // Si el grupo estaba eliminado, quitarlo de eliminados (nuevo mensaje lo reactiva)
  if (deletedChats.has(groupId)) {
    console.log(`✅ Reactivando grupo eliminado: ${groupId}`);
    deletedChats.delete(groupId);
    saveDeletedChats(); // Guardar cambios
  }

  // Si es del grupo actual, mostrarlo
  if (currentChat && currentChat.isGroup && currentChat.id === groupId) {
    // Determinar si fue enviado por el usuario actual (case-insensitive)
    const isSent =
      (messageData.fromUsername || "").toLowerCase() ===
      currentUser.username.toLowerCase();
    displayMessage(messageData, isSent);
  }

  // Actualizar preview en la lista de chats
  const group = allGroups.find((g) => g.id === groupId);
  if (group) {
    updateChatPreview(group.name, messageData.message, groupId);
  } else {
    // Si el grupo no está en la lista, actualizar por ID directamente
    updateChatPreview(groupId, messageData.message, groupId);
  }
}

/**
 * Mostrar mensaje en la UI
 */
function displayMessage(messageData, isSent) {
  const container = document.getElementById("messagesContainer");

  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${isSent ? "sent" : "received"}`;

  const time = new Date(messageData.timestamp).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });

  messageDiv.innerHTML = `
        <div class="message-bubble">
            ${
              !isSent && currentChat.isGroup
                ? `<div class="message-sender">${messageData.fromUsername}</div>`
                : ""
            }
            <div class="message-text">${escapeHtml(messageData.message)}</div>
            <div class="message-time">${time}</div>
        </div>
    `;

  container.appendChild(messageDiv);

  // Scroll al final
  container.scrollTop = container.scrollHeight;
}

/**
 * Cargar mensajes de un chat
 */
async function loadMessages(chatData, isGroup) {
  const container = document.getElementById("messagesContainer");
  container.innerHTML = "";

  try {
    const chatId = isGroup ? chatData.id : chatData.username;
    const response = await fetch(
      `/api/messages/${chatId}?currentUser=${currentUser.username}`
    );
    const messages = await response.json();

    messages.forEach((msg) => {
      const isSent =
        (msg.fromUsername || "").toLowerCase() ===
        currentUser.username.toLowerCase();
      displayMessage(msg, isSent);
    });
  } catch (error) {
    console.error("Error al cargar mensajes:", error);
  }
}

/**
 * Actualizar preview de chat
 */
function updateChatPreview(
  identifier,
  message,
  groupId = null,
  timestamp = null
) {
  const chatId = groupId || identifier;
  const chatElement = document.getElementById(`chat-${chatId}`);

  if (chatElement) {
    const preview = chatElement.querySelector(".chat-item-preview");
    const time = chatElement.querySelector(".chat-item-time");

    if (preview) {
      preview.textContent =
        message.substring(0, 30) + (message.length > 30 ? "..." : "");
    }

    if (time) {
      const displayTime = timestamp ? new Date(timestamp) : new Date();
      time.textContent = displayTime.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    // Mover chat al inicio de la lista
    const chatsList = document.getElementById("chatsList");
    chatsList.insertBefore(chatElement, chatsList.firstChild);
  }
}

// ============================================
// GRUPOS
// ============================================

/**
 * Abrir modal de crear grupo
 */
function openGroupModal() {
  document.getElementById("groupModal").style.display = "flex";
  loadMembersForGroup();
}

/**
 * Cerrar modal de crear grupo
 */
function closeGroupModal() {
  document.getElementById("groupModal").style.display = "none";
  document.getElementById("groupName").value = "";
}

/**
 * Cargar lista de miembros para el grupo
 */
async function loadMembersForGroup() {
  const container = document.getElementById("membersList");
  container.innerHTML = "";

  try {
    const response = await fetch("/api/users");
    const users = await response.json();

    // Filtrar el usuario actual
    const availableUsers = users.filter(
      (u) => u.username !== currentUser.username
    );

    if (availableUsers.length === 0) {
      container.innerHTML =
        '<p style="color: var(--text-secondary); padding: 10px;">No hay usuarios disponibles</p>';
      return;
    }

    availableUsers.forEach((user) => {
      const memberDiv = document.createElement("div");
      memberDiv.className = "member-item";

      memberDiv.innerHTML = `
                <input type="checkbox" id="member-${user.username}" value="${user.username}">
                <label for="member-${user.username}" style="display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1;">
                    <span style="font-size: 30px;">${user.avatar}</span>
                    <span style="color: var(--text-primary);">${user.username}</span>
                </label>
            `;

      container.appendChild(memberDiv);
    });
  } catch (error) {
    console.error("Error al cargar miembros:", error);
    container.innerHTML =
      '<p style="color: var(--text-secondary); padding: 10px;">Error al cargar usuarios</p>';
  }
}

/**
 * Crear grupo
 */
function createGroup() {
  const groupName = document.getElementById("groupName").value.trim();

  if (!groupName) {
    // alert("Por favor ingresa un nombre para el grupo");
    showKiosNotification("Por favor ingresa un nombre para el grupo");
    return;
  }

  // Obtener miembros seleccionados
  const checkboxes = document.querySelectorAll(
    '#membersList input[type="checkbox"]:checked'
  );
  const members = Array.from(checkboxes).map((cb) => cb.value);

  if (members.length === 0) {
    // alert("Selecciona al menos un miembro");
    showKiosNotification("Selecciona al menos un miembro");
    return;
  }

  // Agregar al creador
  members.push(currentUser.username);

  // Emitir evento para crear grupo
  socket.emit("create-group", {
    groupName: groupName,
    members: members,
    creator: currentUser.username,
  });

  showKiosNotification('Grupo "' + groupName + '" creado');
}

// ============================================
// UTILIDADES
// ============================================

/**
 * Cambiar entre pestañas
 */
function switchTab(tabName) {
  // Actualizar botones
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");

  // Actualizar contenido
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });
  document.querySelector(`[data-content="${tabName}"]`).classList.add("active");
}

/**
 * Cargar todos los contactos disponibles
 */
async function loadAllContacts() {
  try {
    const response = await fetch("/api/users");
    const users = await response.json();

    const container = document.getElementById("allContactsList");
    container.innerHTML = "";

    // Filtrar el usuario actual
    const contacts = users.filter((u) => u.username !== currentUser.username);

    if (contacts.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><p>No hay contactos disponibles</p></div>';
      return;
    }

    contacts.forEach((user) => {
      const contactElement = createContactElement(user);
      container.appendChild(contactElement);
    });
  } catch (error) {
    console.error("Error al cargar contactos:", error);
  }
}

/**
 * Crear elemento de contacto
 */
function createContactElement(user) {
  const div = document.createElement("div");
  div.className = "contact-item";

  const statusClass = user.online ? "online" : "";
  const statusText = user.online
    ? "🟢 En línea"
    : `Última vez ${formatLastSeen(user.lastSeen)}`;

  div.innerHTML = `
        <span class="contact-avatar">${user.avatar || "👤"}</span>
        <div class="contact-info">
            <div class="contact-name">${user.username}</div>
            </div>
            <div class="contact-status ${statusClass}">${statusText}</div>
    `;

  // Agregar event listener para hacer clic
  div.addEventListener("click", () => startChatWithUser(user));

  return div;
}

/**
 * Mostrar indicador de escritura
 */
function showTypingIndicator(show) {
  const indicator = document.getElementById("typingIndicator");
  indicator.style.display = show ? "block" : "none";
}

/**
 * Actualizar estado del chat
 */
// function updateChatStatus(username, online, lastSeen) {
//   if (currentChat && currentChat.username === username) {
//     const statusElement = document.getElementById("chatStatus");
//     statusElement.textContent = online
//       ? "en línea"
//       : `última vez ${formatLastSeen(lastSeen)}`;
//   }
// }

/**
 * Formatear última vez visto
 */
function formatLastSeen(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  return date.toLocaleDateString("es-ES");
}

/**
 * Filtrar chats
 */
function filterChats(query) {
  const chatItems = document.querySelectorAll(".chat-item");
  const searchQuery = query.toLowerCase();

  chatItems.forEach((item) => {
    const name = item
      .querySelector(".chat-item-name")
      .textContent.toLowerCase();
    item.style.display = name.includes(searchQuery) ? "flex" : "none";
  });
}

/**
 * Mostrar notificación
 */
function showNotification(message) {
  console.log("🔔", message);
  // Aquí podrías agregar notificaciones del navegador
}

/**
 * Escapar HTML para prevenir XSS
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Cerrar sesión
 */
async function logout() {
  const confirmed = await showKiosNotificationConfirm("¿Desea cerrar sesión?");
  if (confirmed) {
    sessionStorage.removeItem("kios_username");
    sessionStorage.removeItem("kios_avatar");
    socket.disconnect();
    window.location.href = "index.html";
  }
}

/**
 * CARGAR CHATS ANTERIORES AL INICIAR SESIÓN
 */
async function loadPreviousChats() {
  try {
    // Primero cargar grupos guardados
    loadGroupsFromLocalStorage();

    // Cargar todos los mensajes del usuario
    const response = await fetch(`/api/user-messages/${currentUser.username}`);
    const messages = await response.json();

    console.log("📥 Cargando chats anteriores para:", currentUser.username);
    console.log("📥 Total de mensajes encontrados:", messages.length);
    console.log("📥 Chats eliminados actuales:", Array.from(deletedChats));

    // Crear un mapa de chats únicos con el último mensaje
    const chatsMap = new Map();

    messages.forEach((msg) => {
      // Determinar con quién es el chat (comparación case-insensitive)
      const fromUserLower = (msg.fromUsername || "").toLowerCase();
      const currentUserLower = currentUser.username.toLowerCase();
      const toUserLower = (msg.to || "").toLowerCase();

      let otherUser;
      if (fromUserLower === currentUserLower) {
        otherUser = msg.to;
      } else if (toUserLower === currentUserLower) {
        otherUser = msg.fromUsername;
      } else {
        console.log("⚠️ Mensaje no pertenece a este usuario:", msg);
        return;
      }

      // IGNORAR chats con username inválido
      if (
        !otherUser ||
        otherUser === "undefined" ||
        otherUser === "null" ||
        otherUser.trim() === ""
      ) {
        console.log(`🚫 Chat con username inválido ignorado: "${otherUser}"`);
        return;
      }

      // Si no existe el chat o este mensaje es más reciente
      if (
        !chatsMap.has(otherUser) ||
        new Date(msg.timestamp) > new Date(chatsMap.get(otherUser).timestamp)
      ) {
        chatsMap.set(otherUser, {
          username: otherUser,
          lastMessage: msg.message,
          timestamp: msg.timestamp,
          messageCount: (chatsMap.get(otherUser)?.messageCount || 0) + 1,
        });
      }
    });

    console.log("📥 Chats únicos encontrados:", Array.from(chatsMap.keys()));

    // Crear elementos de chat para cada conversación
    chatsMap.forEach((chatInfo, username) => {
      // VERIFICAR SI EL CHAT ESTÁ ELIMINADO O ARCHIVADO
      if (deletedChats.has(username) || archivedChats.has(username)) {
        console.log(
          `🚫 Chat ${username} está eliminado/archivado, no se cargará`
        );
        return; // Saltar este chat
      }

      console.log(`✅ Cargando chat con: ${username}`);

      // Buscar el usuario en la lista de usuarios online/offline (case-insensitive)
      const user = allUsers.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );

      // Crear objeto de usuario con la info que tenemos
      const chatUser = {
        username: username,
        avatar: user?.avatar || "😊", // Avatar por defecto si no está online
        online: !!user,
      };

      // Agregar a la lista de chats (solo si no está eliminado o archivado)
      addChatToList(chatUser, false, chatInfo.lastMessage, chatInfo.timestamp);
    });

    console.log(`✅ ${chatsMap.size} chats cargados exitosamente`);
  } catch (error) {
    console.error("❌ Error al cargar chats anteriores:", error);
  }
}

/**
 * FUNCIONALIDAD DE EMOJIS
 */

// Estado del selector de emojis
let emojiPickerOpen = false;

// Inicializar funcionalidad de emojis
function initializeEmojiPicker() {
  const emojiButton = document.getElementById("emojiButton");
  const emojiPicker = document.getElementById("emojiPicker");
  const emojiItems = document.querySelectorAll(".emoji-item");
  const emojiSearch = document.getElementById("emojiSearch");
  const messageInput = document.getElementById("messageInput");

  // Toggle emoji picker
  if (emojiButton) {
    emojiButton.addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPickerOpen = !emojiPickerOpen;

      if (emojiPickerOpen) {
        emojiPicker.classList.add("show");
      } else {
        emojiPicker.classList.remove("show");
      }
    });
  }

  // Seleccionar emoji
  emojiItems.forEach((item) => {
    item.addEventListener("click", () => {
      const emoji = item.getAttribute("data-emoji");
      const currentValue = messageInput.value;
      const cursorPosition = messageInput.selectionStart;

      // Insertar emoji en la posición del cursor
      const newValue =
        currentValue.substring(0, cursorPosition) +
        emoji +
        currentValue.substring(cursorPosition);

      messageInput.value = newValue;

      // Mover cursor después del emoji
      const newCursorPosition = cursorPosition + emoji.length;
      messageInput.setSelectionRange(newCursorPosition, newCursorPosition);

      // Enfocar el input
      messageInput.focus();

      // Cerrar el picker
      emojiPicker.classList.remove("show");
      emojiPickerOpen = false;
    });
  });

  // Buscar emojis
  if (emojiSearch) {
    emojiSearch.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase();
      const categories = document.querySelectorAll(".emoji-category");

      categories.forEach((category) => {
        const items = category.querySelectorAll(".emoji-item");
        let hasVisibleItems = false;

        items.forEach((item) => {
          const emoji = item.getAttribute("data-emoji");
          // Podrías agregar palabras clave aquí si quisieras búsqueda más avanzada
          item.style.display = "block";
          hasVisibleItems = true;
        });

        category.style.display = hasVisibleItems ? "block" : "none";
      });
    });
  }

  // Cerrar al hacer clic fuera
  document.addEventListener("click", (e) => {
    if (
      emojiPickerOpen &&
      !emojiPicker.contains(e.target) &&
      e.target !== emojiButton
    ) {
      emojiPicker.classList.remove("show");
      emojiPickerOpen = false;
    }
  });

  // Prevenir que el click en el picker lo cierre
  if (emojiPicker) {
    emojiPicker.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
}

/**
 * FUNCIONALIDAD DE BÚSQUEDA MEJORADA
 */

// Inicializar búsqueda de chats y contactos
function initializeSearch() {
  const searchInput = document.getElementById("searchInput");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      const activeTab = document
        .querySelector(".tab-btn.active")
        .getAttribute("data-tab");

      if (activeTab === "chats") {
        searchChats(query);
      } else if (activeTab === "contacts") {
        searchContacts(query);
      }
    });

    // Limpiar búsqueda al cambiar de pestaña
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        searchInput.value = "";
        searchChats("");
        searchContacts("");
      });
    });
  }
}

/**
 * Buscar en chats
 */
function searchChats(query) {
  const chatsList = document.getElementById("chatsList");
  const chatItems = chatsList.querySelectorAll(".chat-item");
  let visibleCount = 0;

  chatItems.forEach((item) => {
    const name =
      item.querySelector(".chat-item-name")?.textContent.toLowerCase() || "";
    const preview =
      item.querySelector(".chat-item-preview")?.textContent.toLowerCase() || "";

    const matches = name.includes(query) || preview.includes(query);

    if (matches || query === "") {
      item.style.display = "flex";
      visibleCount++;
    } else {
      item.style.display = "none";
    }
  });

  // Mostrar mensaje si no hay resultados
  const emptyState = chatsList.querySelector(".empty-state");
  if (visibleCount === 0 && query !== "") {
    if (!emptyState) {
      const noResults = document.createElement("div");
      noResults.className = "empty-state";
      noResults.innerHTML = `
                <p>No se encontraron chats</p>
                <p style="font-size: 13px; color: var(--text-secondary);">Intenta con otro término</p>
            `;
      chatsList.appendChild(noResults);
    }
  }
}

/**
 * Buscar en contactos
 */
function searchContacts(query) {
  const contactsList = document.getElementById("allContactsList");
  const contactItems = contactsList.querySelectorAll(".contact-item");
  let visibleCount = 0;

  contactItems.forEach((item) => {
    const name =
      item.querySelector(".contact-name")?.textContent.toLowerCase() || "";

    if (name.includes(query) || query === "") {
      item.style.display = "flex";
      visibleCount++;
    } else {
      item.style.display = "none";
    }
  });

  // Mostrar mensaje si no hay resultados
  if (visibleCount === 0 && query !== "") {
    if (!contactsList.querySelector(".empty-state")) {
      const noResults = document.createElement("div");
      noResults.className = "empty-state";
      noResults.innerHTML = `
                <p>No se encontraron contactos</p>
                <p style="font-size: 13px; color: var(--text-secondary);">Intenta con otro nombre</p>
            `;
      contactsList.appendChild(noResults);
    }
  } else {
    const emptyState = contactsList.querySelector(".empty-state");
    if (emptyState && query === "") {
      emptyState.remove();
    }
  }
}

// Inicializar al cargar la página
if (document.getElementById("emojiButton")) {
  initializeEmojiPicker();
}

if (document.getElementById("searchInput")) {
  initializeSearch();
}

/**
 * FUNCIONALIDAD DE MENÚ DESPLEGABLE EN CHATS
 */

// Toggle menú de chat
function toggleChatMenu(event, chatId, isGroup) {
  event.stopPropagation();

  // Cerrar todos los menús
  document.querySelectorAll(".chat-dropdown-menu").forEach((menu) => {
    if (menu.id !== `menu-${chatId}`) {
      menu.style.display = "none";
    }
  });

  // Toggle el menú actual
  const menu = document.getElementById(`menu-${chatId}`);
  if (menu) {
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  }
}

// Eliminar chat
async function deleteChat(chatId, isGroup, event) {
  event.stopPropagation();

  const chatName =
    currentChat &&
    (currentChat.id === chatId || currentChat.username === chatId)
      ? currentChat.name || currentChat.username
      : chatId;

  let confirmed = await showKiosNotificationConfirm(
    "¿Desea alimninar este chat?"
  );
  if (confirmed) {
    // Agregar a la lista de eliminados
    deletedChats.add(chatId);
    saveDeletedChats();

    const chatElement = document.getElementById(`chat-${chatId}`);
    if (chatElement) {
      chatElement.style.opacity = "0";
      chatElement.style.transform = "scale(0.8)";

      setTimeout(() => {
        chatElement.remove();
        showNotification(isGroup ? "Grupo eliminado" : "Chat eliminado");

        // Si era el chat actual, cerrar el chat
        if (
          currentChat &&
          (currentChat.id === chatId || currentChat.username === chatId)
        ) {
          document.getElementById("noChatSelected").style.display = "flex";
          document.getElementById("activeChat").style.display = "none";
          currentChat = null;
        }

        // Verificar si no quedan chats
        const chatsList = document.getElementById("chatsList");
        if (chatsList.querySelectorAll(".chat-item").length === 0) {
          chatsList.innerHTML = `
                        <div class="empty-state">
                            <p>No tienes conversaciones activas</p>
                            <p style="font-size: 13px; color: var(--text-secondary);">Ve a Contactos para iniciar un chat</p>
                        </div>
                    `;
        }
      }, 200);
    }
  }

  // Cerrar menú
  document.querySelectorAll(".chat-dropdown-menu").forEach((menu) => {
    menu.style.display = "none";
  });
}

// Mostrar información del grupo
async function showGroupInfo(groupId, event) {
  event.stopPropagation();

  // Cerrar menús
  document.querySelectorAll(".chat-dropdown-menu").forEach((menu) => {
    menu.style.display = "none";
  });

  // Buscar el grupo
  const group = allGroups.find((g) => g.id === groupId);

  if (!group) {
    // alert("No se pudo encontrar la información del grupo");
    showKiosNotification("No se pudo encontrar la información del grupo");
    return;
  }

  // Actualizar modal con información del grupo
  document.getElementById("groupAvatarLarge").textContent =
    group.avatar || "👥";
  document.getElementById("groupNameDisplay").textContent = group.name;
  document.getElementById(
    "groupCreatorDisplay"
  ).textContent = `Creado por ${group.creator}`;

  // Cargar lista de miembros
  const membersList = document.getElementById("groupMembersList");
  membersList.innerHTML = "";

  if (group.members && group.members.length > 0) {
    group.members.forEach((memberUsername) => {
      // Buscar el usuario en la lista de usuarios
      const user = allUsers.find((u) => u.username === memberUsername);
      const isOnline = user && user.online;
      const avatar = user ? user.avatar : "👤";

      const memberDiv = document.createElement("div");
      memberDiv.className = "group-member-item";
      memberDiv.innerHTML = `
                <div class="member-avatar">${avatar}</div>
                <div class="member-info">
                    <div class="member-name">${memberUsername}${
        memberUsername === currentUser.username ? " (Tú)" : ""
      }</div>
                </div>
            `;
      membersList.appendChild(memberDiv);
    });
  } else {
    membersList.innerHTML =
      '<p style="color: var(--text-secondary); padding: 20px; text-align: center;">No hay miembros en este grupo</p>';
  }

  // Mostrar modal
  document.getElementById("groupInfoModal").style.display = "flex";
}

// Cerrar modal de info del grupo
document
  .getElementById("closeGroupInfoModal")
  ?.addEventListener("click", () => {
    document.getElementById("groupInfoModal").style.display = "none";
  });

// Cerrar modal al hacer clic fuera
document.getElementById("groupInfoModal")?.addEventListener("click", (e) => {
  if (e.target.id === "groupInfoModal") {
    document.getElementById("groupInfoModal").style.display = "none";
  }
});

// Cerrar menús al hacer clic fuera
document.addEventListener("click", (e) => {
  if (
    !e.target.closest(".chat-menu-btn") &&
    !e.target.closest(".chat-dropdown-menu")
  ) {
    document.querySelectorAll(".chat-dropdown-menu").forEach((menu) => {
      menu.style.display = "none";
    });
  }
});

/**
 * FUNCIONES DE PERSISTENCIA
 */

// Cargar chats eliminados desde localStorage
function loadDeletedChats() {
  const storageKey = `kios_deleted_${currentUser.username}`;

  try {
    const deletedData = localStorage.getItem(storageKey);
    if (deletedData) {
      const parsed = JSON.parse(deletedData);
      deletedChats = new Set(parsed);
      console.log("✅ Chats eliminados cargados:", deletedChats);
    } else {
      deletedChats = new Set();
    }

    // SOLO agregar automáticamente valores inválidos a la lista de eliminados
    deletedChats.add("undefined");
    deletedChats.add("null");
    deletedChats.add("");

    // Guardar para persistir
    saveDeletedChats();
  } catch (error) {
    console.error("Error al cargar chats eliminados:", error);
    deletedChats = new Set(["undefined", "null", ""]);
  }
}

// Guardar chats eliminados en localStorage
function saveDeletedChats() {
  const storageKey = `kios_deleted_${currentUser.username}`;

  try {
    localStorage.setItem(storageKey, JSON.stringify([...deletedChats]));
    console.log("💾 Chats eliminados guardados");
  } catch (error) {
    console.error("Error al guardar chats eliminados:", error);
  }
}

// Guardar grupo en localStorage
function saveGroupToLocalStorage(group) {
  const storageKey = `kios_groups_${currentUser.username}`;

  try {
    let groups = [];
    const storedGroups = localStorage.getItem(storageKey);
    if (storedGroups) {
      groups = JSON.parse(storedGroups);
    }

    // Verificar si el grupo ya existe
    const existingIndex = groups.findIndex((g) => g.id === group.id);
    if (existingIndex >= 0) {
      groups[existingIndex] = group;
    } else {
      groups.push(group);
    }

    localStorage.setItem(storageKey, JSON.stringify(groups));
    console.log("💾 Grupo guardado:", group.name);
  } catch (error) {
    console.error("Error al guardar grupo:", error);
  }
}

// Cargar grupos desde localStorage
function loadGroupsFromLocalStorage() {
  const storageKey = `kios_groups_${currentUser.username}`;

  try {
    const storedGroups = localStorage.getItem(storageKey);
    if (storedGroups) {
      const groups = JSON.parse(storedGroups);
      console.log("✅ Grupos cargados desde localStorage:", groups);

      groups.forEach((group) => {
        // VERIFICAR SI EL GRUPO ESTÁ ELIMINADO O ARCHIVADO
        if (deletedChats.has(group.id) || archivedChats.has(group.id)) {
          console.log(
            `🚫 Grupo ${group.id} está eliminado/archivado, no se cargará`
          );
          return; // Saltar este grupo
        }

        // Verificar que el usuario actual es miembro del grupo (case-insensitive)
        const isMember =
          group.members &&
          group.members.some(
            (member) =>
              member.toLowerCase() === currentUser.username.toLowerCase()
          );

        if (isMember) {
          allGroups.push(group);
          addChatToList(group, true);

          // Unirse automáticamente a la sala del grupo
          socket.emit("join-group", group.id);
          console.log(`✅ Unido al grupo: ${group.name}`);
        }
      });
    }
  } catch (error) {
    console.error("Error al cargar grupos:", error);
  }
}
