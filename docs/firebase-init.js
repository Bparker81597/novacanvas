import {initializeApp} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-storage.js";

const firebaseConfig = window.NOVACANVAS_FIREBASE_CONFIG;
const statusNodes = Array.from(document.querySelectorAll("[data-firebase-status]"));

const defaultUserData = {
  displayName: "Elora Vance",
  bio: "Architect of digital dreamscapes and urban neon narratives. Specializing in high-fidelity glassmorphism and large-scale augmented reality murals that bridge the physical and digital void.",
  stats: {
    followers: "12.8k",
    artworks: 342,
    artprizeWins: 12,
    streakDays: 48,
  },
  challenge: {
    level: 14,
    rank: "#482",
    currentXp: 2450,
    nextXp: 5000,
  },
  artprizeChecklist: {
    framingMounting: false,
    hardwareAudit: false,
    touchUpKit: false,
    portfolioAssets4k: false,
    videoSizzleReel: false,
    newsletterSignup: false,
    businessCards: false,
    stickersSwag: false,
    socialSchedule: false,
    transportPlan: false,
    loadInPermit: false,
    insuranceDocs: false,
  },
};

const defaultProjects = [
  {
    idSuffix: "neo-tokyo-overgrowth",
    title: "Neo-Tokyo Overgrowth",
    summary: "Flow Analysis: Neo-Traditional Backpiece v2",
    progress: 74,
    updatedLabel: "2h ago",
    ownerSlot: 0,
    feedbackThread: [
      {
        author: "Nova AI Assistant",
        role: "ai",
        message: "The curvature of the primary body could be tightened around the shoulder blade for better anatomical flow.",
      },
      {
        author: "Marcus Chen",
        role: "mentor",
        message: "Solid contrast, but try a warmer secondary highlight to make the focal eye pop more.",
      },
    ],
  },
  {
    idSuffix: "void-sanctuary-sculpt",
    title: "Void Sanctuary Sculpt",
    summary: "Spatial composition study for floating sanctuary sculpt",
    progress: 42,
    updatedLabel: "1d ago",
    ownerSlot: 1,
  },
];

let db;
let storage;
let userRef;
let currentUid = null;
let profileUnsub = null;
let projectsUnsub = null;
let profileSaveBound = false;
let checklistBound = false;
let currentProjects = [];
const projectListeners = new Set();

function setStatus(message) {
  statusNodes.forEach((node) => {
    node.textContent = message;
  });
}

function formatPercent(value) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function renderProfile(data) {
  if (!data) {
    return;
  }

  document.querySelectorAll("[data-profile-name]").forEach((node) => {
    node.textContent = data.displayName || defaultUserData.displayName;
  });

  document.querySelectorAll("[data-profile-bio]").forEach((node) => {
    node.textContent = data.bio || defaultUserData.bio;
  });

  const stats = data.stats || {};
  const followers = document.querySelector("[data-stat-followers]");
  const artworks = document.querySelector("[data-stat-artworks]");
  const artprizeWins = document.querySelector("[data-stat-artprize-wins]");
  const streak = document.querySelector("[data-stat-streak]");

  if (followers) {
    followers.textContent = stats.followers ?? defaultUserData.stats.followers;
  }

  if (artworks) {
    artworks.textContent = String(stats.artworks ?? defaultUserData.stats.artworks);
  }

  if (artprizeWins) {
    artprizeWins.textContent = String(stats.artprizeWins ?? defaultUserData.stats.artprizeWins);
  }

  if (streak) {
    streak.textContent = String(stats.streakDays ?? defaultUserData.stats.streakDays);
  }

  document.querySelectorAll("[data-profile-input='displayName']").forEach((node) => {
    if (document.activeElement !== node) {
      node.value = data.displayName || defaultUserData.displayName;
    }
  });

  document.querySelectorAll("[data-profile-input='bio']").forEach((node) => {
    if (document.activeElement !== node) {
      node.value = data.bio || defaultUserData.bio;
    }
  });

  const challenge = data.challenge || {};
  const level = document.querySelector("[data-user-level]");
  const rank = document.querySelector("[data-user-rank]");
  const xpText = document.querySelector("[data-user-xp]");
  const xpBar = document.querySelector("[data-user-xp-bar]");

  const currentXp = challenge.currentXp ?? defaultUserData.challenge.currentXp;
  const nextXp = challenge.nextXp ?? defaultUserData.challenge.nextXp;
  const xpPercent = nextXp > 0 ? (currentXp / nextXp) * 100 : 0;

  if (level) {
    level.textContent = String(challenge.level ?? defaultUserData.challenge.level);
  }

  if (rank) {
    rank.textContent = challenge.rank ?? defaultUserData.challenge.rank;
  }

  if (xpText) {
    xpText.textContent = `${currentXp.toLocaleString()} / ${nextXp.toLocaleString()} XP`;
  }

  if (xpBar) {
    xpBar.style.width = formatPercent(xpPercent);
  }

  renderChecklist(data.artprizeChecklist || defaultUserData.artprizeChecklist);
}

function renderProjects(projects) {
  currentProjects = projects;
  projectListeners.forEach((listener) => listener(projects));

  const cards = Array.from(document.querySelectorAll("[data-project-card]"));
  cards.forEach((card, index) => {
    const project = projects[index];
    if (!project) {
      return;
    }

    const title = card.querySelector("[data-project-title]");
    const edited = card.querySelector("[data-project-edited]");
    const progress = card.querySelector("[data-project-progress]");
    const bar = card.querySelector("[data-project-bar]");

    if (title) {
      title.textContent = project.title;
    }

    if (edited) {
      edited.textContent = `Last edit: ${project.updatedLabel}`;
    }

    if (progress) {
      progress.textContent = formatPercent(project.progress);
    }

    if (bar) {
      bar.style.width = formatPercent(project.progress);
    }
  });

  const activeTitle = document.querySelector("[data-active-project-title]");
  const activeSummary = document.querySelector("[data-active-project-summary]");
  if (projects[0]) {
    if (activeTitle) {
      activeTitle.textContent = projects[0].title;
    }
    if (activeSummary) {
      activeSummary.textContent = projects[0].summary;
    }
  }
}

function renderChecklist(checklist) {
  const inputs = Array.from(document.querySelectorAll("[data-checklist-key]"));
  let checked = 0;

  inputs.forEach((input) => {
    const key = input.getAttribute("data-checklist-key");
    const value = Boolean(checklist[key]);
    input.checked = value;
    if (value) {
      checked += 1;
    }
  });

  const label = document.querySelector("[data-artprize-progress-label]");
  if (label && inputs.length > 0) {
    const percent = Math.round((checked / inputs.length) * 100);
    label.textContent = `${percent}% Complete`;
  }
}

async function ensureProjects(uid) {
  const projectQuery = query(collection(db, "projects"), where("ownerId", "==", uid));
  const existing = await getDocs(projectQuery);
  if (!existing.empty) {
    const backfill = existing.docs
      .map((snapshot) => ({id: snapshot.id, ...snapshot.data()}))
      .filter((project) => project.ownerSlot === 0 && !Array.isArray(project.feedbackThread))
      .map((project) =>
        setDoc(
          doc(db, "projects", project.id),
          {
            feedbackThread: defaultProjects[0].feedbackThread,
            updatedAt: serverTimestamp(),
          },
          {merge: true},
        ),
      );

    if (backfill.length > 0) {
      await Promise.all(backfill);
    }

    return;
  }

  await Promise.all(
    defaultProjects.map((project) =>
      setDoc(doc(db, "projects", `${uid}-${project.idSuffix}`), {
        ownerId: uid,
        title: project.title,
        summary: project.summary,
        progress: project.progress,
        updatedLabel: project.updatedLabel,
        ownerSlot: project.ownerSlot,
        feedbackThread: project.feedbackThread || [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ),
  );
}

async function ensureUser(uid) {
  userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      ...defaultUserData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await ensureProjects(uid);
}

function bindProfileSave() {
  if (profileSaveBound) {
    return;
  }

  const button = document.getElementById("save-profile-button");
  if (!button) {
    return;
  }

  profileSaveBound = true;
  button.addEventListener("click", async () => {
    if (!userRef) {
      return;
    }

    const displayNameInput = document.querySelector("[data-profile-input='displayName']");
    const bioInput = document.querySelector("[data-profile-input='bio']");

    const displayName = displayNameInput?.value?.trim() || defaultUserData.displayName;
    const bio = bioInput?.value?.trim() || defaultUserData.bio;

    button.disabled = true;
    button.textContent = "Saving...";

    try {
      await updateDoc(userRef, {
        displayName,
        bio,
        updatedAt: serverTimestamp(),
      });
      setStatus(`Saved profile for ${displayName}`);
      document.getElementById("edit-profile-panel")?.classList.add("translate-x-full");
    } catch (error) {
      console.error(error);
      setStatus("Profile save failed");
    } finally {
      button.disabled = false;
      button.textContent = "Save Changes";
    }
  });
}

function bindChecklist() {
  if (checklistBound) {
    return;
  }

  const inputs = Array.from(document.querySelectorAll("[data-checklist-key]"));
  if (inputs.length === 0) {
    return;
  }

  checklistBound = true;
  inputs.forEach((input) => {
    input.addEventListener("change", async (event) => {
      if (!userRef) {
        return;
      }

      const key = event.currentTarget.getAttribute("data-checklist-key");
      try {
        await updateDoc(userRef, {
          [`artprizeChecklist.${key}`]: event.currentTarget.checked,
          updatedAt: serverTimestamp(),
        });
        setStatus("Saved checklist");
      } catch (error) {
        console.error(error);
        setStatus("Checklist sync failed");
      }
    });
  });
}

function subscribeToData(uid) {
  profileUnsub?.();
  projectsUnsub?.();

  profileUnsub = onSnapshot(
    doc(db, "users", uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        return;
      }
      renderProfile(snapshot.data());
    },
    (error) => {
      console.error(error);
      setStatus("User sync failed");
    },
  );

  projectsUnsub = onSnapshot(
    query(collection(db, "projects"), where("ownerId", "==", uid)),
    (snapshot) => {
      const projects = snapshot.docs
        .map((item) => ({id: item.id, ...item.data()}))
        .sort((a, b) => (a.ownerSlot ?? 0) - (b.ownerSlot ?? 0));
      renderProjects(projects);
    },
    (error) => {
      console.error(error);
      setStatus("Project sync failed");
    },
  );
}

function getPrimaryProject() {
  return currentProjects[0] || null;
}

async function updatePrimaryProject(patch) {
  if (!currentUid) {
    throw new Error("No current user");
  }

  const primary = getPrimaryProject();
  const docId = primary?.id || `${currentUid}-${defaultProjects[0].idSuffix}`;
  const projectRef = doc(db, "projects", docId);

  await setDoc(
    projectRef,
    {
      ownerId: currentUid,
      ownerSlot: 0,
      updatedAt: serverTimestamp(),
      ...patch,
    },
    {merge: true},
  );
}

async function addProjectFeedback(entry) {
  if (!currentUid) {
    throw new Error("No current user");
  }

  const primary = getPrimaryProject();
  const docId = primary?.id || `${currentUid}-${defaultProjects[0].idSuffix}`;
  const projectRef = doc(db, "projects", docId);
  const payload = typeof entry === "string" ? {
    author: "You",
    role: "user",
    message: entry,
  } : {
    author: entry?.author || "Nova AI Assistant",
    role: entry?.role || "ai",
    message: entry?.message || "",
  };

  await updateDoc(projectRef, {
    feedbackThread: arrayUnion({
      ...payload,
      createdAt: new Date().toISOString(),
    }),
    updatedAt: serverTimestamp(),
    updatedLabel: "just now",
  });
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

async function uploadStudioSketch(file, projectId) {
  if (!currentUid) {
    throw new Error("No current user");
  }

  if (!storage) {
    throw new Error("Storage not initialized");
  }

  const primary = getPrimaryProject();
  const docId = projectId || primary?.id || `${currentUid}-${defaultProjects[0].idSuffix}`;
  const safeFileName = sanitizeFileName(file.name || "sketch.png");
  const path = `users/${currentUid}/projects/${docId}/sketches/${Date.now()}-${safeFileName}`;
  const sketchRef = storageRef(storage, path);

  await uploadBytes(sketchRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      ownerId: currentUid,
      projectId: docId,
      originalFileName: file.name || "sketch.png",
    },
  });

  const downloadUrl = await getDownloadURL(sketchRef);
  return {
    storagePath: path,
    downloadUrl,
    fileName: file.name || "sketch.png",
    contentType: file.type || "application/octet-stream",
  };
}

function subscribeProjects(listener) {
  projectListeners.add(listener);
  if (currentProjects.length > 0) {
    listener(currentProjects);
  }

  return () => {
    projectListeners.delete(listener);
  };
}

async function initFirebase() {
  if (!firebaseConfig) {
    setStatus("Firebase config missing");
    return;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
  const auth = getAuth(app);

  bindProfileSave();
  bindChecklist();
  setStatus("Connecting...");

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      return;
    }

    currentUid = user.uid;
    setStatus(`Connected to ${firebaseConfig.projectId}`);

    try {
      await ensureUser(user.uid);
      subscribeToData(user.uid);
      window.NovaCanvas = {
        ...(window.NovaCanvas || {}),
        uid: user.uid,
        subscribeProjects,
        updatePrimaryProject,
        addProjectFeedback,
        uploadStudioSketch,
        getPrimaryProject,
      };
    } catch (error) {
      console.error(error);
      setStatus("Firestore bootstrap failed");
    }
  });

  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error(error);
    setStatus("Enable Anonymous Auth for live sync");
  }
}

initFirebase();
