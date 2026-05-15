const page = document.body?.dataset?.page;

if (page === "studio") {
  initStudio();
}

function initStudio() {
  const ui = window.NovaCanvasUI;
  const fileInput = document.querySelector("[data-studio-file-input]");
  const canvasImage = document.querySelector("[data-active-canvas-image]");
  const uploadState = document.querySelector("[data-upload-state]");
  const scoreNode = document.querySelector("[data-flow-score]");
  const contrastNode = document.querySelector("[data-flow-contrast]");
  const edgesNode = document.querySelector("[data-flow-edges]");
  const feedbackNode = document.querySelector("[data-ai-feedback]");
  const feedbackThread = document.querySelector("[data-feedback-thread]");
  const feedbackInput = document.querySelector("[data-feedback-input]");
  const aiCard = document.querySelector("[data-feedback-ai-card]");
  const peerCard = document.querySelector("[data-feedback-peer-card]");

  const state = {
    imageDataUrl: null,
    fileName: null,
    analysis: null,
    primaryProject: null,
  };

  hydrateLocalState();
  bindActions();
  subscribeFirebaseState();

  function storageKey(suffix) {
    const uid = window.NovaCanvas?.uid || "anon";
    return `novacanvas:studio:${uid}:${suffix}`;
  }

  function hydrateLocalState() {
    const savedImage = localStorage.getItem(storageKey("image"));
    const savedFileName = localStorage.getItem(storageKey("fileName"));
    const savedAnalysis = localStorage.getItem(storageKey("analysis"));

    if (savedImage) {
      state.imageDataUrl = savedImage;
      state.fileName = savedFileName || "Uploaded sketch";
      canvasImage.src = savedImage;
      uploadState.textContent = state.fileName;
    }

    if (savedAnalysis) {
      try {
        state.analysis = JSON.parse(savedAnalysis);
        renderAnalysis(state.analysis);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function subscribeFirebaseState() {
    const bind = () => {
      if (!window.NovaCanvas?.subscribeProjects) {
        window.setTimeout(bind, 250);
        return;
      }

      window.NovaCanvas.subscribeProjects((projects) => {
        const primary = projects?.[0];
        if (!primary) {
          return;
        }

        state.primaryProject = primary;

        if (primary.sketchUrl && primary.sketchUrl !== state.imageDataUrl) {
          state.imageDataUrl = primary.sketchUrl;
          state.fileName = primary.sketchFileName || state.fileName || "Uploaded sketch";
          canvasImage.src = primary.sketchUrl;
          uploadState.textContent = `${state.fileName} synced`;
          localStorage.setItem(storageKey("image"), primary.sketchUrl);
          localStorage.setItem(storageKey("fileName"), state.fileName);
        }

        if (primary.flowCheck) {
          state.analysis = primary.flowCheck;
          renderAnalysis(primary.flowCheck);
        }

        if (primary.feedbackThread) {
          renderFeedback(primary.feedbackThread);
        }
      });
    };

    bind();
  }

  function bindActions() {
    document.addEventListener("click", async (event) => {
      const actionNode = event.target.closest("[data-action]");
      if (!actionNode) {
        return;
      }

      const action = actionNode.getAttribute("data-action");

      if (action === "studio-upload-sketch") {
        fileInput.click();
        return;
      }

      if (action === "studio-flow-check") {
        if (!state.imageDataUrl) {
          ui?.showToast?.("Upload a sketch first");
          return;
        }

        const analysis = await runFlowCheck(state.imageDataUrl);
        state.analysis = analysis;
        localStorage.setItem(storageKey("analysis"), JSON.stringify(analysis));
        renderAnalysis(analysis);
        await persistProjectUpdate({
          flowCheck: analysis,
          updatedLabel: "just now",
          progress: Math.max(42, Math.min(96, analysis.score)),
          summary: `Flow score ${analysis.score}% • ${analysis.recommendation}`,
        });
        await persistFeedback(`Flow Check: ${analysis.recommendation}`);
        ui?.showToast?.("Flow check complete");
        return;
      }

      if (action === "studio-send-feedback") {
        const message = feedbackInput?.value?.trim();
        if (!message) {
          ui?.showToast?.("Write feedback before sending");
          return;
        }

        await persistFeedback(message);
        const reply = generateCritiqueReply(message);
        if (reply) {
          await persistFeedback({
            author: "Nova AI Assistant",
            role: "ai",
            message: reply,
          });
        }
        feedbackInput.value = "";
        ui?.showToast?.("Feedback sent");
        return;
      }

      if (action === "studio-layer-ops") {
        ui?.openModal?.(`
          <h2 class="mb-4 text-2xl font-headline-md text-white">Layer Ops</h2>
          <p class="mb-4 text-on-surface-variant">Layer operations are scaffolded for the live demo. Next step is attaching named layer groups, opacity, and version states to project documents.</p>
          <div class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-primary-fixed-dim">Suggested layer groups: sketch, structure, color, detail, export.</div>
        `);
        return;
      }

      if (action === "studio-export-lab") {
        if (!state.imageDataUrl) {
          ui?.showToast?.("Upload a sketch before exporting");
          return;
        }

        const link = document.createElement("a");
        link.href = state.imageDataUrl;
        link.download = (state.fileName || "novacanvas-sketch").replace(/\.[^.]+$/, "") + "-export.png";
        link.click();
        ui?.showToast?.("Exported current canvas");
      }
    });

    fileInput.addEventListener("change", async (event) => {
      const [file] = event.target.files || [];
      if (!file) {
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      state.imageDataUrl = dataUrl;
      state.fileName = file.name;
      canvasImage.src = dataUrl;
      uploadState.textContent = `${file.name} uploading...`;
      localStorage.setItem(storageKey("image"), dataUrl);
      localStorage.setItem(storageKey("fileName"), file.name);

      try {
        const uploadResult = await uploadSketchToCloud(file);
        state.imageDataUrl = uploadResult.downloadUrl;
        canvasImage.src = uploadResult.downloadUrl;
        uploadState.textContent = `${uploadResult.fileName} synced`;
        localStorage.setItem(storageKey("image"), uploadResult.downloadUrl);
        localStorage.setItem(storageKey("fileName"), uploadResult.fileName);

        await persistProjectUpdate({
          title: file.name.replace(/\.[^.]+$/, ""),
          summary: "Uploaded sketch synced to cloud storage and ready for flow analysis",
          updatedLabel: "just now",
          sketchUrl: uploadResult.downloadUrl,
          sketchStoragePath: uploadResult.storagePath,
          sketchFileName: uploadResult.fileName,
          sketchContentType: uploadResult.contentType,
        });

        ui?.showToast?.("Sketch uploaded to Firebase Storage");
      } catch (error) {
        console.error(error);
        uploadState.textContent = `${file.name} upload failed`;
        ui?.showToast?.("Storage upload failed");
      } finally {
        fileInput.value = "";
      }
    });
  }

  async function persistProjectUpdate(patch) {
    if (!window.NovaCanvas?.updatePrimaryProject) {
      return;
    }

    try {
      await window.NovaCanvas.updatePrimaryProject(patch);
    } catch (error) {
      console.error(error);
      ui?.showToast?.("Project sync failed");
    }
  }

  async function persistFeedback(entry) {
    if (!window.NovaCanvas?.addProjectFeedback) {
      return;
    }

    try {
      await window.NovaCanvas.addProjectFeedback(entry);
    } catch (error) {
      console.error(error);
      ui?.showToast?.("Feedback sync failed");
    }
  }

  async function uploadSketchToCloud(file) {
    if (!window.NovaCanvas?.uploadStudioSketch) {
      throw new Error("Storage upload unavailable");
    }

    return window.NovaCanvas.uploadStudioSketch(file, state.primaryProject?.id);
  }

  function renderAnalysis(analysis) {
    if (!analysis) {
      return;
    }

    scoreNode.textContent = `${analysis.score}%`;
    contrastNode.textContent = analysis.contrastLabel;
    edgesNode.textContent = analysis.edgeLabel;
    feedbackNode.textContent = `“${analysis.recommendation}”`;
  }

  function renderFeedback(items) {
    if (!feedbackThread || !Array.isArray(items)) {
      return;
    }

    aiCard?.remove();
    peerCard?.remove();
    feedbackThread.innerHTML = "";

    items.forEach((item) => {
      const card = document.createElement("div");
      const isAi = item.role === "ai";
      const isUser = item.role === "user";
      card.className = isAi
        ? "rounded-lg border-l-4 border-secondary-container bg-surface-container-high/40 p-4"
        : "rounded-lg border border-white/10 bg-white/5 p-4";
      const header = document.createElement("div");
      header.className = "mb-2 flex gap-3";

      const avatar = document.createElement("div");
      if (isAi) {
        avatar.className = "flex h-8 w-8 items-center justify-center rounded-full bg-secondary-container/20";
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined text-sm text-secondary";
        icon.textContent = "smart_toy";
        avatar.appendChild(icon);
      } else {
        avatar.className = "flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-surface-container-high text-xs text-primary-fixed-dim";
        avatar.textContent = isUser ? "You" : "MC";
      }

      const author = document.createElement("span");
      author.className = `font-label-md ${isAi ? "text-secondary" : "text-on-surface"}`;
      author.textContent = item.author;

      const body = document.createElement("p");
      body.className = "text-sm text-on-surface-variant";
      body.textContent = `“${item.message}”`;

      header.append(avatar, author);
      card.append(header, body);
      feedbackThread.appendChild(card);
    });
  }

  function generateCritiqueReply(message) {
    const trimmed = message.trim();
    if (!trimmed) {
      return "";
    }

    const analysis = state.analysis;
    const projectName = state.primaryProject?.title || state.fileName?.replace(/\.[^.]+$/, "") || "this piece";
    const topic = inferTopic(trimmed);

    if (!analysis) {
      return `For ${projectName}, I can give stronger critique after a Flow Check. Right now I would focus first on ${topic.focus}, then test two small variations so the focal read becomes clearer.`;
    }

    const contrastLine = analysis.contrastLabel === "High"
      ? "Your contrast separation is already doing useful work, so adjust focal emphasis without flattening the dark-to-light rhythm."
      : analysis.contrastLabel === "Balanced"
        ? "The contrast range is balanced, which gives you room to push one area harder for a stronger focal hierarchy."
        : "The current contrast read is still quiet, so the fastest improvement is a clearer light-vs-shadow split around the subject.";

    const edgeLine = analysis.edgeLabel === "High"
      ? "Edge energy is dense, so reserve your sharpest transitions for the main subject and let supporting zones breathe."
      : analysis.edgeLabel === "Balanced"
        ? "Edge energy is controlled, which means you can selectively sharpen one contour to improve direction and intent."
        : "The edge structure is soft right now, so one decisive contour pass would help the form hold together.";

    const paletteLine = analysis.recommendation.toLowerCase().includes("cool")
      ? "Because the image is leaning cooler, one warmer accent would create a cleaner visual anchor."
      : analysis.recommendation.toLowerCase().includes("warm")
        ? "Because the palette is running warm, a cooler counterpoint would keep the surface from collapsing into one temperature band."
        : "The palette is serviceable, but a tighter temperature split would make the composition feel more authored.";

    return `${contrastLine} ${edgeLine} For ${projectName}, on the question of ${topic.label}, I would ${topic.action} ${paletteLine}`;
  }

  function inferTopic(message) {
    const normalized = message.toLowerCase();
    if (normalized.includes("color") || normalized.includes("palette") || normalized.includes("tone")) {
      return {
        label: "color and palette control",
        focus: "color temperature and value grouping",
        action: "test one dominant palette family with a single accent temperature",
      };
    }

    if (normalized.includes("light") || normalized.includes("shadow") || normalized.includes("contrast")) {
      return {
        label: "lighting and contrast",
        focus: "your brightest zone against your quietest dark",
        action: "tighten the lighting hierarchy around the intended focal point",
      };
    }

    if (normalized.includes("composition") || normalized.includes("focal") || normalized.includes("layout")) {
      return {
        label: "composition",
        focus: "focal hierarchy and directional flow",
        action: "simplify one competing area so the eye lands faster on the main read",
      };
    }

    if (normalized.includes("edge") || normalized.includes("line") || normalized.includes("shape")) {
      return {
        label: "edge control",
        focus: "shape clarity and selective sharpness",
        action: "sharpen only the highest-priority contour and soften secondary transitions",
      };
    }

    return {
      label: "overall refinement",
      focus: "value grouping and focal clarity",
      action: "run one pass on hierarchy first, then a second pass on accent detail",
    };
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function runFlowCheck(imageDataUrl) {
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", {willReadFrequently: true});
  const width = 160;
  const height = Math.max(1, Math.round((image.height / image.width) * width));
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);
  const {data} = ctx.getImageData(0, 0, width, height);

  let brightnessSum = 0;
  const values = new Array(width * height);
  let warmSum = 0;
  let coolSum = 0;
  let saturationSum = 0;
  let centerWeight = 0;
  let outerWeight = 0;
  let leftWeight = 0;
  let rightWeight = 0;
  let topWeight = 0;
  let bottomWeight = 0;

  for (let i = 0; i < values.length; i += 1) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    values[i] = value;
    brightnessSum += value;

    const x = i % width;
    const y = Math.floor(i / width);
    const dx = Math.abs(x - width / 2) / (width / 2);
    const dy = Math.abs(y - height / 2) / (height / 2);
    const radialDistance = Math.sqrt(dx * dx + dy * dy);
    const maxRgb = Math.max(r, g, b);
    const minRgb = Math.min(r, g, b);
    const saturation = maxRgb === 0 ? 0 : ((maxRgb - minRgb) / maxRgb) * 100;
    saturationSum += saturation;
    warmSum += r - b;
    coolSum += b - r;

    if (radialDistance < 0.45) {
      centerWeight += value;
    } else {
      outerWeight += value;
    }

    if (x < width / 2) {
      leftWeight += value;
    } else {
      rightWeight += value;
    }

    if (y < height / 2) {
      topWeight += value;
    } else {
      bottomWeight += value;
    }
  }

  const brightnessAvg = brightnessSum / values.length;
  let varianceSum = 0;
  let edgeSum = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = values[index];
      varianceSum += (value - brightnessAvg) ** 2;

      if (x < width - 1) {
        edgeSum += Math.abs(value - values[index + 1]);
      }
      if (y < height - 1) {
        edgeSum += Math.abs(value - values[index + width]);
      }
    }
  }

  const contrast = Math.sqrt(varianceSum / values.length);
  const edgeDensity = edgeSum / (values.length * 2);
  const averageSaturation = saturationSum / values.length;
  const horizontalBias = ((rightWeight - leftWeight) / Math.max(1, rightWeight + leftWeight)) * 100;
  const verticalBias = ((bottomWeight - topWeight) / Math.max(1, bottomWeight + topWeight)) * 100;
  const centerBias = ((centerWeight - outerWeight) / Math.max(1, centerWeight + outerWeight)) * 100;
  const warmth = warmSum / values.length;
  const coolness = coolSum / values.length;

  const brightnessScore = 100 - Math.min(100, Math.abs(brightnessAvg - 128) * 0.8);
  const contrastScore = Math.min(100, contrast * 1.8);
  const edgeScore = Math.min(100, edgeDensity * 1.6);
  const centerScore = 100 - Math.min(100, Math.abs(centerBias) * 2.2);
  const score = Math.round(
    brightnessScore * 0.18 +
      contrastScore * 0.32 +
      edgeScore * 0.28 +
      centerScore * 0.22,
  );

  const contrastLabel = contrast >= 58 ? "High" : contrast >= 38 ? "Balanced" : "Soft";
  const edgeLabel = edgeDensity >= 42 ? "Dense" : edgeDensity >= 24 ? "Controlled" : "Loose";
  const temperatureLabel =
    warmth > 12 ? "warm-leaning" : coolness > 12 ? "cool-leaning" : "temperature-balanced";
  const focalLabel =
    centerBias > 8 ? "center-weighted" : centerBias < -8 ? "edge-weighted" : "evenly distributed";
  const orientationLabel =
    Math.abs(horizontalBias) > Math.abs(verticalBias)
      ? horizontalBias > 0
        ? "right-drifting"
        : "left-drifting"
      : verticalBias > 0
        ? "bottom-heavy"
        : "top-heavy";
  const paletteLabel =
    averageSaturation > 46 ? "high-chroma" : averageSaturation > 24 ? "moderately saturated" : "muted";

  const recommendation = buildRecommendation({
    score,
    contrast,
    edgeDensity,
    brightnessAvg,
    averageSaturation,
    horizontalBias,
    verticalBias,
    centerBias,
    temperatureLabel,
    focalLabel,
    orientationLabel,
    paletteLabel,
  });

  return {
    score,
    brightness: Math.round(brightnessAvg),
    contrast: Math.round(contrast),
    edgeDensity: Math.round(edgeDensity),
    saturation: Math.round(averageSaturation),
    focalBias: Math.round(centerBias),
    horizontalBias: Math.round(horizontalBias),
    verticalBias: Math.round(verticalBias),
    contrastLabel,
    edgeLabel,
    temperatureLabel,
    focalLabel,
    orientationLabel,
    paletteLabel,
    recommendation,
    analyzedAt: new Date().toISOString(),
  };
}

function buildRecommendation(metrics) {
  const openings = [
    "This sketch reads as",
    "The current composition feels",
    "Your uploaded piece is coming through as",
    "The overall motion here feels",
  ];

  const opener =
    openings[
      Math.abs(
        Math.round(
          metrics.score +
            metrics.contrast +
            metrics.edgeDensity +
            metrics.saturation +
            metrics.horizontalBias +
            metrics.verticalBias,
        ),
      ) % openings.length
    ];

  const clauses = [
    `${metrics.focalLabel}, ${metrics.orientationLabel}, and ${metrics.paletteLabel}.`,
  ];

  if (metrics.contrast < 34) {
    clauses.push("Push a cleaner value split around the focal path so the main form separates faster.");
  } else if (metrics.contrast > 62) {
    clauses.push("The value snap is already strong, so the next win is controlling where the sharpest contrast lands.");
  } else {
    clauses.push("The contrast band is usable, but a tighter focal hotspot would make the eye travel more decisively.");
  }

  if (metrics.edgeDensity < 22) {
    clauses.push("Edge information is sparse, which makes the silhouette feel soft; sharpen one dominant contour and let the rest stay quiet.");
  } else if (metrics.edgeDensity > 46) {
    clauses.push("There is a lot of edge activity, so simplifying the secondary clusters would keep the composition from fragmenting.");
  } else {
    clauses.push("Edge density is controlled, and you can now emphasize hierarchy by making one region crisper than the others.");
  }

  if (metrics.centerBias > 8) {
    clauses.push("Because the energy is pooling near the center, consider extending one line of force farther outward to create a stronger sweep.");
  } else if (metrics.centerBias < -8) {
    clauses.push("The visual pull lives more on the perimeter, so anchoring one central focal mass would make the composition feel more intentional.");
  } else {
    clauses.push("The focal distribution is fairly even, so a single dominant anchor would help turn rhythm into a clearer statement.");
  }

  if (metrics.temperatureLabel === "warm-leaning") {
    clauses.push("The warmer bias gives it heat; a cooler accent in the focal zone could create cleaner dimensional contrast.");
  } else if (metrics.temperatureLabel === "cool-leaning") {
    clauses.push("The cooler bias supports atmosphere well; a restrained warm interruption could make the main subject feel more alive.");
  } else {
    clauses.push("The temperature balance is steady, which means your next decision can be more expressive rather than corrective.");
  }

  if (metrics.brightnessAvg < 92) {
    clauses.push("Overall it sits dark, so a deliberate lift in the key planes would keep detail from collapsing in presentation.");
  } else if (metrics.brightnessAvg > 168) {
    clauses.push("It is reading bright overall, so protecting a few deeper value pockets would give the piece more depth.");
  }

  return `${opener} ${clauses.join(" ")}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
