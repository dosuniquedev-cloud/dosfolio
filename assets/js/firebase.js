
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, increment, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

console.log("Firebase Tracking Script Loaded");

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCEOukgeJg6t4jQlN82ebIbBDPXDGEv4x4",
    authDomain: "dosfolio-project.firebaseapp.com",
    projectId: "dosfolio-project",
    storageBucket: "dosfolio-project.firebasestorage.app",
    messagingSenderId: "944442404065",
    appId: "1:944442404065:web:2a1ae3bcde02f30fae9ba0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- ADMIN / LOCAL DEVICE EXCLUSION CHECK ---
// Excludes local development, self visits, and creator devices from registering in DB or inflating view counts
function isExcludedDevice(ipData = {}) {
    // 1. Localhost / local IP / file protocol
    const host = window.location.hostname || '';
    const isLocal = host === 'localhost' ||
                    host === '127.0.0.1' ||
                    host === '' ||
                    window.location.protocol === 'file:' ||
                    host.startsWith('192.168.') ||
                    host.startsWith('10.') ||
                    host.endsWith('.local');
    if (isLocal) {
        try { localStorage.setItem('dos_admin_device', 'true'); } catch (e) {}
        return true;
    }

    // 2. Query param or URL hash trigger (?admin, ?dev, ?ignore, #admin)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('admin') || urlParams.has('dev') || urlParams.has('ignore') || window.location.hash === '#admin') {
            localStorage.setItem('dos_admin_device', 'true');
            return true;
        }
    } catch (e) {}

    // 3. Persistent localStorage flag
    try {
        if (localStorage.getItem('dos_admin_device') === 'true' ||
            localStorage.getItem('dos_exclude_telemetry') === 'true' ||
            localStorage.getItem('is_admin') === 'true') {
            return true;
        }
    } catch (e) {}

    // 4. IP Check (Creator's current network)
    const knownAdminIPs = [
        "106.219.75.46" // Creator's IP
    ];
    if (ipData && ipData.ip && knownAdminIPs.includes(ipData.ip)) {
        try { localStorage.setItem('dos_admin_device', 'true'); } catch (e) {}
        return true;
    }

    return false;
}

// --- SESSION & REFRESH REPEAT PREVENTION ---
// Prevents duplicate increments & DB spam when users reload or refresh the page repeatedly
function isRepeatVisitInSession() {
    try {
        // 1. Session Storage: active for the current browser tab session
        if (sessionStorage.getItem('dos_session_recorded') === 'true') {
            return true;
        }

        // 2. 30-Minute cooldown window in localStorage: prevents duplicate count if user reopens site within 30 mins
        const lastTracked = localStorage.getItem('dos_last_tracked_time');
        if (lastTracked) {
            const timePassed = Date.now() - parseInt(lastTracked, 10);
            const THIRTY_MINUTES = 30 * 60 * 1000;
            if (timePassed < THIRTY_MINUTES) {
                return true;
            }
        }
    } catch (e) {
        console.warn("Storage session check warning:", e);
    }
    return false;
}

function markSessionAsRecorded() {
    try {
        sessionStorage.setItem('dos_session_recorded', 'true');
        localStorage.setItem('dos_last_tracked_time', String(Date.now()));
    } catch (e) {}
}

// --- VISITOR TRACKING LOGIC ---
function updateAllDisplays(views) {
    if (views === undefined || views === null) return;
    try { localStorage.setItem('dos_cached_views', String(views)); } catch (e) {}
    const targets = document.querySelectorAll('.view-counter-val, #view-counter, #preloader-counter, #bottom-bar-counter, #footer-bottom-counter');
    targets.forEach(el => {
        el.innerText = views;
    });
}

async function trackVisitor() {
    console.log("Starting Visitor Telemetry check...");
    const statusDiv = document.getElementById('statusMsg');
    const statsRef = doc(db, "dosfolio_stats", "general");

    try {
        // Quick local check before any network request
        let isExcluded = isExcludedDevice();

        // Safe IP Fetch (Prevents Crash on AdBlocker)
        let ipData = {};
        try {
            const ipRes = await fetch('https://ipapi.co/json/');
            if (ipRes.ok) ipData = await ipRes.json();
        } catch (e) {
            console.warn("IP Fetch blocked:", e);
            ipData = { ip: "Unknown", city: "Unknown", country_name: "Unknown" };
        }

        // Secondary exclusion check with resolved IP
        if (!isExcluded && isExcludedDevice(ipData)) {
            isExcluded = true;
        }

        // 1) If local device or creator PC -> DO NOT register in visitors & DO NOT increment count
        if (isExcluded) {
            console.log("Admin/Local device identified. Registration and view count increment skipped.");
            
            // Still display current visitor count across all UI elements (preloader, bottom bar, cards)
            const docSnap = await getDoc(statsRef);
            if (docSnap.exists()) {
                updateAllDisplays(docSnap.data().views);
            }
            if (statusDiv) {
                statusDiv.innerText = "System: Online · Admin Device (Untracked)";
            }
            return;
        }

        // 2) Check if visitor has already been counted in this session or refreshed recently
        if (isRepeatVisitInSession()) {
            console.log("Active session detected. Skipping duplicate visitor registration and counter increment.");
            const docSnap = await getDoc(statsRef);
            if (docSnap.exists()) {
                updateAllDisplays(docSnap.data().views);
            }
            if (statusDiv) {
                statusDiv.innerText = "System: Online · Active Session";
            }
            return;
        }

        // --- REAL NEW VISITOR REGISTRATION ---
        // Device Info (UAParser)
        let result = { os: { name: "Unknown", version: "" }, browser: { name: "Unknown" } };
        try {
            if (typeof window.UAParser !== 'undefined') {
                const parser = new window.UAParser();
                result = parser.getResult();
            }
        } catch (e) {
            console.warn("UAParser error:", e);
        }

        // Safe GPS (With Timeout)
        const getGPS = () => new Promise(resolve => {
            if (!navigator.geolocation) return resolve("Not Supported");
            const timer = setTimeout(() => resolve("Timeout"), 3000);
            navigator.geolocation.getCurrentPosition(
                pos => { clearTimeout(timer); resolve(`${pos.coords.latitude}, ${pos.coords.longitude}`); },
                err => { clearTimeout(timer); resolve("Denied"); }
            );
        });
        const gpsVal = await getGPS();

        // Gather Visitor Payload
        const visitorData = {
            timestamp: new Date(),
            ip_info: {
                ip: ipData.ip || "Unknown",
                city: ipData.city || "Unknown",
                country: ipData.country_name || "Unknown",
                lat_long: `${ipData.latitude || 0}, ${ipData.longitude || 0}`
            },
            device: {
                os: `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
                browser: `${result.browser.name || 'Unknown'}`,
                screen: `${window.screen.width}x${window.screen.height}`,
                ram: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Unknown"
            },
            gps_precise: gpsVal
        };

        // Save to Firebase visitors collection
        await addDoc(collection(db, "visitors"), visitorData);
        console.log("Visitor data saved.");

        // Increment database counter & record session
        await updateDoc(statsRef, { views: increment(1) });
        markSessionAsRecorded();

        // Display updated counter everywhere (preloader, bottom bar, telemetry card)
        const docSnap = await getDoc(statsRef);
        if (docSnap.exists()) {
            updateAllDisplays(docSnap.data().views);
        }
        if (statusDiv) statusDiv.innerText = "System: Online & Connected";

    } catch (error) {
        console.error("Tracking Error:", error);
        // Fallback: try fetching count even if recording failed
        try {
            const fallbackSnap = await getDoc(statsRef);
            if (fallbackSnap.exists()) {
                updateAllDisplays(fallbackSnap.data().views);
            }
        } catch (e) {}
        if (statusDiv) statusDiv.innerText = "System: Tracking Offline";
    }
}

// Run Tracking
trackVisitor();

// --- CONTACT FORM LOGIC ---
const contactForm = document.getElementById('contactForm');

if (contactForm) {
    console.log("Contact form found, attaching listener.");
    contactForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        // Get Elements
        const loading = document.querySelector('.loading');
        const sentMsg = document.querySelector('.sent-message');
        const errorMsg = document.querySelector('.error-message');
        const btn = this.querySelector('button[type="submit"]');

        // UI Updates
        loading.style.display = 'block';
        errorMsg.style.display = 'none';
        sentMsg.style.display = 'none';
        btn.disabled = true;

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const subject = document.getElementById('subject').value;
        const message = document.getElementById('message').value;

        try {
            await addDoc(collection(db, "contacts"), {
                name: name,
                email: email,
                subject: subject,
                message: message,
                sentAt: new Date()
            });

            // Success UI
            loading.style.display = 'none';
            sentMsg.style.display = 'block';
            this.reset(); // Clear form

        } catch (error) {
            console.error("Contact Error:", error);
            loading.style.display = 'none';
            errorMsg.innerText = "Failed to send message. Please try again.";
            errorMsg.style.display = 'block';
        } finally {
            btn.disabled = false;
        }
    });
} else {
    console.warn("Contact form not found.");
}


// --- ADMIN SHORTCUT LOGIC & INTERACTIVE TOGGLE ---
let typedKeys = "";
const secretCode = "admin";

document.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;

    if (e.key.length === 1) { // Only printable characters
        typedKeys += e.key.toLowerCase();
    }

    if (typedKeys.length > secretCode.length) {
        typedKeys = typedKeys.slice(-secretCode.length);
    }

    if (typedKeys === secretCode) {
        try {
            localStorage.setItem('dos_admin_device', 'true');
            localStorage.setItem('dos_exclude_telemetry', 'true');
        } catch (err) {}

        const adminTarget = window.location.hostname.includes("github.io")
            ? "https://dosuniquedev-cloud.github.io/dosfolio/admin.html"
            : "admin.html";
        window.location.href = adminTarget;
    }
});

// Double-click on telemetry card to toggle / confirm admin untracked status
const telemetryCard = document.querySelector('.telemetry-card');
if (telemetryCard) {
    telemetryCard.style.cursor = 'pointer';
    telemetryCard.title = 'Double-click to toggle Admin/Creator device exclusion';
    telemetryCard.addEventListener('dblclick', () => {
        const currentlyExcluded = localStorage.getItem('dos_admin_device') === 'true';
        if (currentlyExcluded) {
            localStorage.removeItem('dos_admin_device');
            localStorage.removeItem('dos_exclude_telemetry');
            alert('Admin Mode Disabled: This device will now be tracked like a regular visitor.');
        } else {
            localStorage.setItem('dos_admin_device', 'true');
            localStorage.setItem('dos_exclude_telemetry', 'true');
            alert('Admin Mode Active: This PC is now permanently excluded from telemetry & view counts.');
        }
        window.location.reload();
    });
}

// --- REAL-TIME DYNAMIC TELEMETRY SYNC ---
// Sets up a Firestore onSnapshot listener so the counter updates in real-time across all open clients
try {
    const liveStatsRef = doc(db, "dosfolio_stats", "general");
    onSnapshot(liveStatsRef, (snap) => {
        if (snap.exists()) {
            const liveViews = snap.data().views;
            updateAllDisplays(liveViews);
        }
    }, (err) => {
        console.warn("Real-time telemetry listener warning:", err.message);
    });
} catch (e) {
    console.warn("onSnapshot registration skipped:", e);
}
