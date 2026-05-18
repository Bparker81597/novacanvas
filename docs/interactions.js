const toast = document.createElement("div");
toast.className = "nova-toast";
document.body.appendChild(toast);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function ensureModal() {
  let modal = document.getElementById("nova-modal");
  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = "nova-modal";
  modal.className = "nova-modal hidden";
  modal.innerHTML = `
    <div class="nova-modal__backdrop" data-action="close-modal"></div>
    <div class="nova-modal__panel">
      <button class="nova-modal__close" data-action="close-modal" aria-label="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div id="nova-modal-content"></div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function openModal(html) {
  const modal = ensureModal();
  const content = modal.querySelector("#nova-modal-content");
  content.innerHTML = html;
  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("nova-modal")?.classList.add("hidden");
}

function openProfilePanel() {
  document.getElementById("edit-profile-panel")?.classList.remove("translate-x-full");
}

function closeProfilePanel() {
  document.getElementById("edit-profile-panel")?.classList.add("translate-x-full");
}

window.NovaCanvasUI = {
  showToast,
  openModal,
  closeModal,
  openProfilePanel,
  closeProfilePanel,
};

function downloadQrSvg() {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#ffffff"/>
    <rect x="24" y="24" width="64" height="64" fill="#111417"/>
    <rect x="40" y="40" width="32" height="32" fill="#ffffff"/>
    <rect x="168" y="24" width="64" height="64" fill="#111417"/>
    <rect x="184" y="40" width="32" height="32" fill="#ffffff"/>
    <rect x="24" y="168" width="64" height="64" fill="#111417"/>
    <rect x="40" y="184" width="32" height="32" fill="#ffffff"/>
    <rect x="112" y="24" width="16" height="16" fill="#111417"/>
    <rect x="128" y="40" width="16" height="16" fill="#111417"/>
    <rect x="112" y="56" width="32" height="16" fill="#111417"/>
    <rect x="96" y="96" width="16" height="16" fill="#111417"/>
    <rect x="128" y="96" width="16" height="16" fill="#111417"/>
    <rect x="160" y="96" width="16" height="16" fill="#111417"/>
    <rect x="96" y="128" width="80" height="16" fill="#111417"/>
    <rect x="112" y="160" width="16" height="16" fill="#111417"/>
    <rect x="144" y="160" width="32" height="16" fill="#111417"/>
    <rect x="96" y="192" width="16" height="16" fill="#111417"/>
    <rect x="128" y="192" width="48" height="16" fill="#111417"/>
    <text x="128" y="246" font-family="Inter, sans-serif" font-size="18" text-anchor="middle" fill="#00dce6">NovaCanvas</text>
  </svg>`;

  const blob = new Blob([svg], {type: "image/svg+xml"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "novacanvas-qr.svg";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Downloaded QR SVG");
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.getAttribute("data-action");

  if (action === "open-profile-panel") {
    openProfilePanel();
    return;
  }

  if (action === "close-profile-panel") {
    closeProfilePanel();
    return;
  }

  if (action === "choose-profile-avatar") {
    document.querySelector("[data-profile-avatar-input]")?.click();
    return;
  }

  if (action === "close-modal") {
    closeModal();
    return;
  }

  if (action === "toggle-follow") {
    const following = target.getAttribute("data-following") === "true";
    target.setAttribute("data-following", String(!following));
    target.textContent = following ? "Follow" : "Following";
    target.classList.toggle("bg-primary-fixed-dim", !following);
    target.classList.toggle("text-on-primary-fixed", !following);
    showToast(following ? "Unfollowed Elias Thorne" : "Following Elias Thorne");
    return;
  }

  if (action === "join-challenge") {
    const joined = target.getAttribute("data-joined") === "true";
    target.setAttribute("data-joined", String(!joined));
    target.textContent = joined ? "Join Challenge" : "Joined";
    target.classList.toggle("border-primary-fixed-dim", !joined);
    target.classList.toggle("bg-primary-container/10", !joined);
    showToast(joined ? "Challenge removed" : "Challenge joined");
    return;
  }

  if (action === "launch-simulator") {
    openModal(`
      <h2 class="mb-4 text-2xl font-headline-md text-white">Spatial Simulator</h2>
      <p class="mb-4 text-on-surface-variant">Venue simulation is not fully implemented yet, but this route is now wired. Next step is binding real venue presets and uploaded dimensions from Firestore.</p>
      <div class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-primary-fixed-dim">Queued target venue: Blue Bridge Gallery</div>
    `);
    return;
  }

  if (action === "download-qr-svg") {
    downloadQrSvg();
    return;
  }

  if (action === "view-artwork-details") {
    const title = target.getAttribute("data-artwork-title") || "Artwork";
    const medium = target.getAttribute("data-artwork-medium") || "";
    const year = target.getAttribute("data-artwork-year") || "";
    openModal(`
      <h2 class="mb-3 text-2xl font-headline-md text-white">${title}</h2>
      <p class="mb-4 text-on-surface-variant">${medium} ${year ? "• " + year : ""}</p>
      <p class="mb-4 text-on-surface-variant">This detail surface is now active. The next backend step would be reading a real artwork document and rendering media, metadata, and engagement stats from Firestore.</p>
      <div class="rounded-2xl border border-primary-fixed-dim/20 bg-primary-container/10 p-4 text-sm text-primary-fixed-dim">Portfolio detail view scaffold is ready for Firestore artwork documents.</div>
    `);
    return;
  }

  if (action === "quick-create") {
    window.scrollTo({top: 0, behavior: "smooth"});
    showToast("Quick create tools are next to wire into Studio");
  }
});
