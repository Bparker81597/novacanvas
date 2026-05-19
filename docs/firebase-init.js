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
const defaultAvatarUrl = "./assets/novacanvas-brand-logo.png?v=3";

const defaultUserData = {
  profileVersion: 2,
  createdProfile: false,
  displayName: "",
  bio: "",
  avatarUrl: defaultAvatarUrl,
  stats: {
    followers: "0",
    artworks: 0,
    artprizeWins: 0,
    streakDays: 0,
  },
  challenge: {
    level: 1,
    rank: "--",
    currentXp: 0,
    nextXp: 100,
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

const localProfileStorageKey = "novacanvas.profile";

function isCreatedProfile(data) {
  return Boolean(data?.createdProfile && data?.profileVersion === defaultUserData.profileVersion);
}

let db;
let storage;
let userRef;
let currentUid = null;
let profileUnsub = null;
let projectsUnsub = null;
let profileSaveBound = false;
let checklistBound = false;
let avatarInputBound = false;
let currentProjects = [];
let pendingAvatarDataUrl = null;
let pendingAvatarName = "";
let currentProfileData = {...defaultUserData};
const projectListeners = new Set();

function setStatus(message) {
  statusNodes.forEach((node) => {
    node.textContent = message;
  });
}

function formatPercent(value) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function readLocalProfile() {
  try {
    const raw = localStorage.getItem(localProfileStorageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function writeLocalProfile(data) {
  try {
    localStorage.setItem(localProfileStorageKey, JSON.stringify(data));
  } catch (error) {
    console.error(error);
  }
}

function normalizeProfile(data) {
  if (!isCreatedProfile(data)) {
    return {...defaultUserData};
  }

  return {
    ...defaultUserData,
    ...data,
    createdProfile: true,
    profileVersion: defaultUserData.profileVersion,
    avatarUrl: data.avatarUrl || defaultAvatarUrl,
    stats: {
      ...defaultUserData.stats,
      ...(data.stats || {}),
    },
    challenge: {
      ...defaultUserData.challenge,
      ...(data.challenge || {}),
    },
    artprizeChecklist: {
      ...defaultUserData.artprizeChecklist,
      ...(data.artprizeChecklist || {}),
    },
  };
}

function renderProfile(data) {
  currentProfileData = normalizeProfile(data);
  const hasProfile = isCreatedProfile(currentProfileData);
  const displayName = hasProfile
    ? currentProfileData.displayName || "Untitled Creator"
    : "Create your NovaCanvas profile";
  const bioText = hasProfile
    ? currentProfileData.bio || "Tell visitors about your creative focus."
    : "Add your name, a short bio, and an avatar to start shaping your creator profile.";
  const secondaryBioText = hasProfile
    ? currentProfileData.bio || "Tell visitors about your creative focus."
    : "Your artist story will appear here once you create the profile.";

  document.querySelectorAll("[data-profile-name]").forEach((node) => {
    node.textContent = displayName;
  });

  document.querySelectorAll("[data-profile-bio]").forEach((node) => {
    node.textContent = bioText;
  });

  document.querySelectorAll("[data-profile-bio-secondary]").forEach((node) => {
    node.textContent = secondaryBioText;
  });

  const avatarUrl = pendingAvatarDataUrl || currentProfileData.avatarUrl || defaultAvatarUrl;
  document.querySelectorAll("[data-profile-avatar], [data-profile-avatar-preview]").forEach((node) => {
    node.src = avatarUrl;
    node.alt = `${displayName} avatar`;
  });

  const avatarLabel = document.querySelector("[data-profile-avatar-label]");
  if (avatarLabel) {
    avatarLabel.textContent = pendingAvatarName
      ? `Selected: ${pendingAvatarName}. Saved after you press Save Changes.`
      : "PNG, JPG, or WebP. Saved after you press Save Changes.";
  }

  const badge = document.querySelector("[data-profile-badge]");
  if (badge) {
    badge.textContent = hasProfile ? "Creator Profile Live" : "New Creator";
  }

  const tags = document.querySelector("[data-profile-tags]");
  if (tags) {
    tags.innerHTML = hasProfile
      ? `
        <span class="rounded-full border border-primary-container/20 bg-primary-container/10 px-3 py-1 text-mono-sm uppercase tracking-widest text-primary-fixed-dim">Profile Active</span>
        <span class="rounded-full border border-secondary-container/20 bg-secondary-container/10 px-3 py-1 text-mono-sm uppercase tracking-widest text-secondary-fixed-dim">Creator Setup Complete</span>
      `
      : `
        <span class="rounded-full border border-primary-container/20 bg-primary-container/10 px-3 py-1 text-mono-sm uppercase tracking-widest text-primary-fixed-dim">Profile Setup</span>
        <span class="rounded-full border border-secondary-container/20 bg-secondary-container/10 px-3 py-1 text-mono-sm uppercase tracking-widest text-secondary-fixed-dim">New Creator</span>
      `;
  }

  const emptyState = document.querySelector("[data-profile-empty-state]");
  if (emptyState) {
    emptyState.classList.toggle("hidden", hasProfile);
  }

  const panelTrigger = document.querySelector("[data-profile-panel-trigger]");
  if (panelTrigger) {
    panelTrigger.textContent = hasProfile ? "Edit Profile" : "Create Profile";
  }

  const panelTitle = document.querySelector("[data-profile-panel-title]");
  if (panelTitle) {
    panelTitle.textContent = hasProfile ? "Profile Settings" : "Create Your Profile";
  }

  const saveLabel = document.querySelector("[data-profile-save-label]");
  if (saveLabel) {
    saveLabel.textContent = hasProfile ? "Save Changes" : "Create Profile";
  }

  const stats = currentProfileData.stats || {};
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
      node.value = hasProfile ? currentProfileData.displayName || "" : "";
    }
  });

  document.querySelectorAll("[data-profile-input='bio']").forEach((node) => {
    if (document.activeElement !== node) {
      node.value = hasProfile ? currentProfileData.bio || "" : "";
    }
  });

  const challenge = currentProfileData.challenge || {};
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

  renderChecklist(currentProfileData.artprizeChecklist || defaultUserData.artprizeChecklist);
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
  const localProfile = normalizeProfile(readLocalProfile());

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      ...localProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else if (isCreatedProfile(localProfile)) {
    await setDoc(
      userRef,
      {
        ...localProfile,
        updatedAt: serverTimestamp(),
      },
      {merge: true},
    );
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
    const displayNameInput = document.querySelector("[data-profile-input='displayName']");
    const bioInput = document.querySelector("[data-profile-input='bio']");

    const displayName = displayNameInput?.value?.trim() || "";
    const bio = bioInput?.value?.trim() || "";
    const fallbackBio = "Creator bio coming soon.";
    const finalDisplayName = displayName || "Untitled Creator";
    const finalBio = bio || fallbackBio;
    const localProfile = {
      ...currentProfileData,
      profileVersion: defaultUserData.profileVersion,
      createdProfile: true,
      displayName: finalDisplayName,
      bio: finalBio,
    };

    if (pendingAvatarDataUrl) {
      localProfile.avatarUrl = pendingAvatarDataUrl;
    }

    const updatePayload = {
      profileVersion: defaultUserData.profileVersion,
      createdProfile: true,
      displayName: finalDisplayName,
      bio: finalBio,
      updatedAt: serverTimestamp(),
    };

    if (pendingAvatarDataUrl) {
      updatePayload.avatarUrl = pendingAvatarDataUrl;
    }

    button.disabled = true;
    button.textContent = "Saving...";

    try {
      writeLocalProfile(localProfile);
      renderProfile(localProfile);
      pendingAvatarDataUrl = null;
      pendingAvatarName = "";
      document.getElementById("edit-profile-panel")?.classList.add("translate-x-full");
      window.NovaCanvasUI?.showToast?.("Profile saved");

      if (userRef) {
        await updateDoc(userRef, updatePayload);
        setStatus(`Saved profile for ${finalDisplayName}`);
      } else {
        setStatus(`Saved locally for ${finalDisplayName}`);
      }
    } catch (error) {
      console.error(error);
      setStatus("Profile save failed");
      window.NovaCanvasUI?.showToast?.("Profile save failed");
    } finally {
      button.disabled = false;
      button.textContent = isCreatedProfile(currentProfileData) ? "Save Changes" : "Create Profile";
    }
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Avatar read failed"));
    reader.readAsDataURL(file);
  });
}

async function resizeAvatar(file) {
  const source = await readFileAsDataUrl(file);
  const image = new Image();

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Avatar load failed"));
    image.src = source;
  });

  const maxSize = 512;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Avatar canvas unavailable");
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function bindAvatarInput() {
  if (avatarInputBound) {
    return;
  }

  const input = document.querySelector("[data-profile-avatar-input]");
  if (!input) {
    return;
  }

  avatarInputBound = true;
  input.addEventListener("change", async (event) => {
    const [file] = event.currentTarget.files || [];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file");
      event.currentTarget.value = "";
      return;
    }

    try {
      pendingAvatarDataUrl = await resizeAvatar(file);
      pendingAvatarName = file.name || "avatar.jpg";
      document.querySelectorAll("[data-profile-avatar], [data-profile-avatar-preview]").forEach((node) => {
        node.src = pendingAvatarDataUrl;
      });
      const avatarLabel = document.querySelector("[data-profile-avatar-label]");
      if (avatarLabel) {
        avatarLabel.textContent = `Selected: ${pendingAvatarName}. Saved after you press Save Changes.`;
      }
      setStatus("Avatar ready to save");
    } catch (error) {
      console.error(error);
      pendingAvatarDataUrl = null;
      pendingAvatarName = "";
      setStatus("Avatar processing failed");
    } finally {
      event.currentTarget.value = "";
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
      renderProfile(normalizeProfile(snapshot.data()));
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

function formatUploadTitle(fileName) {
  return (fileName || "Untitled Upload").replace(/\.[^.]+$/, "");
}

function createUploadSummary(flowCheck, fileName) {
  if (flowCheck?.recommendation) {
    return `Flow score ${flowCheck.score}% • ${flowCheck.recommendation}`;
  }

  return `${formatUploadTitle(fileName)} ready for critique and flow analysis`;
}

function createInitialUploadFeedback(flowCheck) {
  if (!flowCheck?.recommendation) {
    return [];
  }

  return [
    {
      author: "Nova AI Assistant",
      role: "ai",
      message: flowCheck.recommendation,
      createdAt: new Date().toISOString(),
    },
  ];
}

function buildProjectMirrorFromUpload(uploadId, patch) {
  const projectPatch = {
    activeUploadId: uploadId,
    updatedAt: serverTimestamp(),
  };

  if (patch.title) {
    projectPatch.title = patch.title;
  }

  if (patch.summary) {
    projectPatch.summary = patch.summary;
  }

  if (typeof patch.progress === "number") {
    projectPatch.progress = patch.progress;
  }

  if (patch.updatedLabel) {
    projectPatch.updatedLabel = patch.updatedLabel;
  }

  if (patch.sketchUrl) {
    projectPatch.sketchUrl = patch.sketchUrl;
  }

  if (patch.sketchStoragePath) {
    projectPatch.sketchStoragePath = patch.sketchStoragePath;
  }

  if (patch.sketchFileName) {
    projectPatch.sketchFileName = patch.sketchFileName;
  }

  if (patch.sketchContentType) {
    projectPatch.sketchContentType = patch.sketchContentType;
  }

  if (patch.flowCheck) {
    projectPatch.flowCheck = patch.flowCheck;
  }

  return projectPatch;
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

async function createProjectUploadVersion(upload) {
  if (!currentUid) {
    throw new Error("No current user");
  }

  const primary = getPrimaryProject();
  const projectId = upload?.projectId || primary?.id || `${currentUid}-${defaultProjects[0].idSuffix}`;
  const uploadsRef = collection(db, "projects", projectId, "uploads");
  const uploadRef = doc(uploadsRef);
  const title = upload.title || formatUploadTitle(upload.fileName);
  const flowCheck = upload.flowCheck || null;
  const payload = {
    ownerId: currentUid,
    projectId,
    title,
    summary: upload.summary || createUploadSummary(flowCheck, upload.fileName),
    progress: typeof upload.progress === "number" ? upload.progress : flowCheck?.score || 42,
    updatedLabel: upload.updatedLabel || "just now",
    sketchUrl: upload.downloadUrl,
    sketchStoragePath: upload.storagePath,
    sketchFileName: upload.fileName || "Uploaded sketch",
    sketchContentType: upload.contentType || "application/octet-stream",
    flowCheck,
    feedbackThread: Array.isArray(upload.feedbackThread)
      ? upload.feedbackThread
      : createInitialUploadFeedback(flowCheck),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(uploadRef, payload);
  await setDoc(
    doc(db, "projects", projectId),
    buildProjectMirrorFromUpload(uploadRef.id, payload),
    {merge: true},
  );

  return {
    id: uploadRef.id,
    ...payload,
  };
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

async function updateProjectUpload(projectId, uploadId, patch) {
  if (!currentUid) {
    throw new Error("No current user");
  }

  if (!projectId || !uploadId) {
    throw new Error("Upload target missing");
  }

  const uploadRef = doc(db, "projects", projectId, "uploads", uploadId);
  const payload = {
    ...patch,
    updatedAt: serverTimestamp(),
  };

  await setDoc(uploadRef, payload, {merge: true});
  await setDoc(
    doc(db, "projects", projectId),
    buildProjectMirrorFromUpload(uploadId, payload),
    {merge: true},
  );
}

async function addUploadFeedback(projectId, uploadId, entry) {
  if (!currentUid) {
    throw new Error("No current user");
  }

  if (!projectId || !uploadId) {
    throw new Error("Upload target missing");
  }

  const uploadRef = doc(db, "projects", projectId, "uploads", uploadId);
  const payload = typeof entry === "string" ? {
    author: "You",
    role: "user",
    message: entry,
  } : {
    author: entry?.author || "Nova AI Assistant",
    role: entry?.role || "ai",
    message: entry?.message || "",
  };

  await updateDoc(uploadRef, {
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

function subscribeProjectUploads(projectId, listener) {
  if (!projectId) {
    return () => {};
  }

  return onSnapshot(
    collection(db, "projects", projectId, "uploads"),
    (snapshot) => {
      const uploads = snapshot.docs
        .map((item) => ({id: item.id, ...item.data()}))
        .sort((a, b) => {
          const aTime = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
          const bTime = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
          return bTime - aTime;
        });
      listener(uploads);
    },
    (error) => {
      console.error(error);
      setStatus("Upload sync failed");
    },
  );
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
  renderProfile(normalizeProfile(readLocalProfile()));

  if (!firebaseConfig) {
    setStatus("Firebase config missing");
    if (!isCreatedProfile(currentProfileData)) {
      window.requestAnimationFrame(() => {
        window.NovaCanvasUI?.openProfilePanel?.();
      });
    }
    return;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
  const auth = getAuth(app);

  bindProfileSave();
  bindAvatarInput();
  bindChecklist();
  setStatus("Connecting...");

  if (!isCreatedProfile(currentProfileData)) {
    window.requestAnimationFrame(() => {
      window.NovaCanvasUI?.openProfilePanel?.();
    });
  }

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
        createProjectUploadVersion,
        updateProjectUpload,
        addProjectFeedback,
        addUploadFeedback,
        uploadStudioSketch,
        subscribeProjectUploads,
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
