
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, increment, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// --- VISITOR TRACKING LOGIC ---
async function trackVisitor() {
    console.log("Starting Visitor Tracking...");
    const statusDiv = document.getElementById('statusMsg');

    try {
        //  Device Info (UAParser )
        // Check for UAParser globally
        if (typeof window.UAParser === 'undefined') {
            console.error("UAParser is not defined! Make sure the CDN script is loaded.");
            if (statusDiv) statusDiv.innerText = "System: Error (UAParser missing)";
            // return; // Optional: return if critical, but maybe we can continue carefully
        }

        const parser = window.UAParser ? new window.UAParser() : new UAParser();
        const result = parser.getResult();

        //  Safe IP Fetch (Prevents Crash on AdBlocker)
        let ipData = {};
        try {
            const ipRes = await fetch('https://ipapi.co/json/');
            if (ipRes.ok) ipData = await ipRes.json();
        } catch (e) {
            console.warn("IP Fetch blocked:", e);
            ipData = { ip: "Unknown", city: "Unknown", country_name: "Unknown" };
        }

        //  Safe GPS (With Timeout)
        const getGPS = () => new Promise(resolve => {
            if (!navigator.geolocation) resolve("Not Supported");
            setTimeout(() => resolve("Timeout"), 3000); // Wait max 3 seconds
            navigator.geolocation.getCurrentPosition(
                pos => resolve(`${pos.coords.latitude}, ${pos.coords.longitude}`),
                err => resolve("Denied")
            );
        });
        const gpsVal = await getGPS();

        //  Gather Data
        const visitorData = {
            timestamp: new Date(),
            ip_info: {
                ip: ipData.ip || "Unknown",
                city: ipData.city || "Unknown",
                country: ipData.country_name || "Unknown",
                lat_long: `${ipData.latitude || 0}, ${ipData.longitude || 0}`
            },
            device: {
                os: `${result.os.name} ${result.os.version}`,
                browser: `${result.browser.name}`,
                screen: `${window.screen.width}x${window.screen.height}`,
                ram: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Unknown"
            },
            gps_precise: gpsVal
        };

        //  Save to Firebase
        await addDoc(collection(db, "visitors"), visitorData);
        console.log("Visitor data saved.");

        //  Update Counter
        const statsRef = doc(db, "dosfolio_stats", "general");
        await updateDoc(statsRef, { views: increment(1) });

        //  Display Counter
        const docSnap = await getDoc(statsRef);
        if (docSnap.exists()) {
            document.getElementById('view-counter').innerText = docSnap.data().views;
        }
        if (statusDiv) statusDiv.innerText = "System: Online & Connected";

    } catch (error) {
        console.error("Tracking Error:", error);
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


// --- ADMIN SHORTCUT LOGIC ---
let typedKeys = "";
const secretCode = "admin";

document.addEventListener("keydown", (e) => {

    const activeTag = document.activeElement.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;


    if (e.key.length === 1) { // Only printable characters
        typedKeys += e.key.toLowerCase();
    }

    // console.log(typedKeys); 


    if (typedKeys.length > secretCode.length) {
        typedKeys = typedKeys.slice(-secretCode.length);
    }


    if (typedKeys === secretCode) {

        window.location.href = "https://dosuniquedev-cloud.github.io/dosfolio/admin";
    }
});
