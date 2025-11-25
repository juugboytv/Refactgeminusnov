import { 
    initializeGlobals, DataManager, ChatManager, SettingsManager, MapDataStore, MapLoader, MapRenderer, WorldMapManager, 
    ModalManager, CreationManager, ProfileManager, CombatManager, SanctuaryManager, 
    StatsManager, InventoryManager, EquipmentManager, UIManager, GameManager, 
    LayoutManager, ZoneManager 
} from './managers.js';

// --- App State & Config ---
let state = {
player: null,
ui: {
isFocused: false,
isLayoutEditMode: false,
selectedInventoryId: null,
selectedGemId: null,
activeTab: 'socket',
activeSocketView: 'visual',
selectedGemForSocketing: null,
itemFilter: { category: 'All', subType: 'All', tier: 'All' },
gemFilter: { type: 'All', grade: 'All' }
},
game: { combatActive: false, currentZoneId: 'Z01', globalJackpot: 0},
zone: {
name: "No Zone Loaded",
},
keyState: { up: false, left: false, down: false, right: false, interact: false },
firebase: {
db: null,
auth: null,
userId: null,
playerDocRef: null,
},
chat: {
currentChannel: 'main',
unsubscribeListener: null,
}
};

// --- Zone Data ---
// As requested, placeholder map data has been removed to create a clean slate.
// The game will now require a map to be imported via the Settings tab to begin.
const embeddedZoneData = null;

// --- UI Elements ---
const ui = {};
document.querySelectorAll('[id]').forEach(el => {
const camelCaseId = el.id.replace(/-(\w)/g, (m, g) => g.toUpperCase());
ui[camelCaseId] = el;
});

// --- Utility Functions ---
function showToast(message, isError = false) {
ui.toastNotification.textContent = message;
ui.toastNotification.className = `glass-panel fixed left-1/2 -translate-x-1/2 z-[210] transition-all duration-500 ease-in-out px-6 py-3 rounded-lg font-semibold ${isError ? 'toast-error' : 'toast-success'}`;
ui.toastNotification.style.bottom = '5rem';
setTimeout(() => { ui.toastNotification.style.bottom = '-100px'; }, 3000);
}

// --- Smoke Canvas Animation ---
const smokeCanvas = document.getElementById('smoke-canvas');
const smokeCtx = smokeCanvas.getContext('2d');
smokeCanvas.width = window.innerWidth;
smokeCanvas.height = window.innerHeight;
let smokeParticles = [];
const smokeParticleCount = 75;

class SmokeParticle {
constructor(color) {
this.x = Math.random() * smokeCanvas.width;
this.y = Math.random() * smokeCanvas.height;
this.size = Math.random() * 150 + 50;
this.speedX = Math.random() * 0.4 - 0.2;
this.speedY = Math.random() * 0.4 - 0.2;
this.color = color;
}
update() {
this.x += this.speedX;
this.y += this.speedY;
if (this.x < -this.size) this.x = smokeCanvas.width + this.size;
if (this.x > smokeCanvas.width + this.size) this.x = -this.size;
if (this.y < -this.size) this.y = smokeCanvas.height + this.size;
if (this.y > smokeCanvas.height + this.size) this.y = -this.size;
}
draw() {
smokeCtx.fillStyle = this.color;
smokeCtx.beginPath();
smokeCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
smokeCtx.filter = 'blur(60px)';
smokeCtx.fill();
}
}

function initSmokeParticles(theme) {
smokeParticles = [];
const color = theme === 'molten-core'
? `rgba(249, 115, 22, ${Math.random() * 0.07})`
: `rgba(34, 211, 238, ${Math.random() * 0.07})`;
for (let i = 0; i < smokeParticleCount; i++) {
smokeParticles.push(new SmokeParticle(color));
}
}

function updateSmokeParticleColors(theme) {
const color = theme === 'molten-core'
? `rgba(249, 115, 22, ${Math.random() * 0.07})`
: `rgba(34, 211, 238, ${Math.random() * 0.07})`;
smokeParticles.forEach(p => {
p.color = color;
});
}

function animateSmoke() {
smokeCtx.clearRect(0, 0, smokeCanvas.width, smokeCanvas.height);
for (let i = 0; i < smokeParticles.length; i++) {
smokeParticles[i].update();
smokeParticles[i].draw();
}
requestAnimationFrame(animateSmoke);
}

window.addEventListener('resize', () => {
smokeCanvas.width = window.innerWidth;
smokeCanvas.height = window.innerHeight;
const currentTheme = localStorage.getItem('geminusTheme') || 'aetherial-shard';
initSmokeParticles(currentTheme);
if(WorldMapManager.isInitialized) {
WorldMapManager.isInitialized = false; // Force re-init to handle canvas resize
WorldMapManager.init();
}
if(ZoneManager.isInitialized) {
    ZoneManager.resizeCanvas();
    ZoneManager.draw();
}
});

// --- Controls System ---
function initControls() {
const keyElements = document.querySelectorAll('.game-key');
const setKeyState = (key, isPressed) => {
state.keyState[key] = isPressed;
document.querySelectorAll(`[data-key="${key}"]`).forEach(el => el.classList.toggle('pressed', isPressed));
};
const handleKeyPress = (key) => {
    if (!state.player || !ZoneManager.isLoaded) return;
    let dx = 0, dy = 0;
    switch(key) {
        case 'up': dy = -1; break;
        case 'down': dy = 1; break;
        case 'left': dx = -1; break;
        case 'right': dx = 1; break;
        case 'interact':
            SanctuaryManager.revivePlayer();
            return;
    }
    const newX = state.player.pos.x + dx;
    const newY = state.player.pos.y + dy;
    const mapSize = MapDataStore.data.mapSize;
    const navigationLayer = MapDataStore.data.layers.find(l => l.id === 'navigation');
    
    // Check if the new position is within map bounds and is walkable
    if (newX >= 0 && newX < mapSize.width && newY >= 0 && newY < mapSize.height && navigationLayer.grid[newY][newX].isWalkable) {
        state.player.pos.x = newX;
        state.player.pos.y = newY;
        ZoneManager.draw();
        WorldMapManager.draw();
        UIManager.updatePlayerStatusUI();
    }
};
keyElements.forEach(element => {
const key = element.dataset.key;
if (!key) return;
element.addEventListener('touchstart', (e) => { e.preventDefault(); setKeyState(key, true); handleKeyPress(key); }, { passive: false });
element.addEventListener('touchend', (e) => { e.preventDefault(); setKeyState(key, false); }, { passive: false });
element.addEventListener('mousedown', (e) => { e.preventDefault(); setKeyState(key, true); handleKeyPress(key); });
element.addEventListener('mouseup', (e) => { e.preventDefault(); setKeyState(key, false); });
element.addEventListener('mouseleave', () => { if (state.keyState[key]) setKeyState(key, false); });
});
window.addEventListener('keydown', (e) => {
if(document.activeElement.tagName === 'INPUT') return;
let key;
switch(e.key) {
case 'ArrowUp': case 'w': key = 'up'; break;
case 'ArrowDown': case 's': key = 'down'; break;
case 'ArrowLeft': case 'a': key = 'left'; break;
case 'ArrowRight': case 'd': key = 'right'; break;
case 'Enter': case ' ': key = 'interact'; break;
default: return;
}
e.preventDefault();
if (!state.keyState[key]) {
setKeyState(key, true);
handleKeyPress(key);
}
});
window.addEventListener('keyup', (e) => {
if(document.activeElement.tagName === 'INPUT') return;
let key;
switch(e.key) {
case 'ArrowUp': case 'w': key = 'up'; break;
case 'ArrowDown': case 's': key = 'down'; break;
case 'ArrowLeft': case 'a': key = 'left'; break;
case 'ArrowRight': case 'd': key = 'right'; break;
case 'Enter': case ' ': key = 'interact'; break;
default: return;
}
e.preventDefault();
setKeyState(key, false);
});
}

// --- Main Initialization ---
function main() {
// Initialize globals for managers
initializeGlobals({
    state, ui, showToast, MapDataStore, embeddedZoneData, 
    updateSmokeParticleColors, initSmokeParticles
});

// Initialize smoke animation
animateSmoke();

// Initialize controls
initControls();

// Load theme and initialize data manager
SettingsManager.loadTheme();
DataManager.init();
}

document.addEventListener('DOMContentLoaded', main);