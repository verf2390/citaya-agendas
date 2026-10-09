"use client";
import { directAfterAnalysis } from "@/lib/video/directorFlow.mjs";
import { structuredMediaFirst, mediaFirstPolicy, mediaFirstDraft, requestMediaFirstState, mediaFirstStatus } from "@/lib/video/mediaFirstPolicy.mjs";

import {
  CheckCircle2,
  Clapperboard,
  Download,
  FileAudio2,
  FileVideo2,
  ImageIcon,
  LoaderCircle,
  Play,
  RefreshCcw,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/admin/AdminNav";
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSectionCard,
  EmptyState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { adminFetch } from "@/lib/api/adminFetch";

type VideoAsset = {
  id: string;
  assetType: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  width: number | null;
  height: number | null;
  createdAt: number;
};

type MediaFirstState = {
  structured: boolean;
  effectiveMediaFirst: boolean;
  source: "website_showcase" | "structured" | "brief" | "none";
};

function useMediaFirstStatus(config: Record<string, unknown> | null,
  request: (body: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const inputKey = config ? JSON.stringify(config) : null;
  const [result, setResult] = useState<{ key: string; state: MediaFirstState | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!inputKey) return;
    return requestMediaFirstState({ config: JSON.parse(inputKey), request, onResult: setResult });
  }, [inputKey, request]);
  return mediaFirstStatus(result, inputKey);
}

type VideoJob = {
  id: string;
  revision: number;
  status: string;
  mode: "preview" | "final";
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  errorCode: string | null;
  renderSeconds: number;
  attempt: number;
};

type VideoOutput = {
  id: string;
  jobId: string;
  outputType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
};

type VideoProject = {
  id: string;
  title: string;
  status: string;
  templateId: string;
  videoType: string;
  niche: string;
  revision: number;
  config: Record<string, unknown>;
  updatedAt: number;
  assets: VideoAsset[];
  jobs: VideoJob[];
  outputs: VideoOutput[];
  approvedPreviewJobIds: string[];
};

type ProjectSummary = {
  id: string;
  title: string;
  status: string;
  templateId: string;
  updatedAt: number;
};

const NICHES = [
  ["barber", "Barbería"],
  ["beauty", "Belleza y estética"],
  ["veterinary", "Veterinaria"],
  ["psychology", "Psicología"],
  ["dentistry", "Odontología"],
  ["massage", "Masajes"],
  ["healthcare", "Salud"],
  ["architecture", "Arquitectura"],
  ["local-business", "Negocio local"],
  ["professional-services", "Servicios profesionales"],
  ["restaurant", "Restaurante"],
  ["retail", "Tienda / comercio"],
  ["construction", "Construcción"],
] as const;

const ERROR_LABELS: Record<string, string> = {
  VISUAL_ANALYSIS_REQUIRED: "Análisis visual requerido. Revisa los medios seleccionados y vuelve a autorizar su análisis.",
  ANALYSIS_APPROVAL_REQUIRED: "Autoriza el análisis local de las imágenes y videos seleccionados.",
  VISUAL_ANALYSIS_FAILED: "Falló análisis visual. No se generó un montaje; vuelve a intentarlo.",
  ANALYSIS_START_FAILED: "No se pudo iniciar el análisis visual. Reintenta Dirigir con IA.",
  ANALYSIS_QUEUE_TIMEOUT: "El análisis visual no pudo obtener turno. Reintenta Dirigir con IA.",
  LEASE_EXPIRED: "El worker dejó de responder. Reintenta la operación.",
  DIRECTOR_VISUAL_STALE: "Los medios o el proyecto cambiaron. Vuelve a dirigir el video.",
  DIRECTOR_MEDIA_INVALID: "El Director no seleccionó medios analizados válidos. Vuelve a intentarlo.",
  DIRECTOR_MEDIA_TOO_SHORT: "El material seleccionado no alcanza para el montaje. Añade imágenes o clips más largos.",
  DIRECTOR_SEGMENT_UNSUPPORTED: "El análisis no permite justificar ese corte. Usa el video desde el inicio.",
  INVALID_ORIGIN: "La solicitud no proviene de este panel.",
  RATE_LIMITED: "Demasiadas solicitudes. Intenta nuevamente en un momento.",
  INVALID_UPLOAD: "El archivo no es válido o supera el límite permitido.",
  MEDIA_REVIEW_REQUIRED: "Confirma que revisaste los medios antes del preview.",
  PROJECT_BUSY: "El proyecto ya tiene un render en curso.",
  FINAL_APPROVAL_REQUIRED: "Aprueba el preview actual antes de generar el final.",
  PREVIEW_APPROVAL_INVALID: "Ese preview ya no corresponde a la revisión actual.",
  AI_GATEWAY_UNAVAILABLE: "Qwen local no está respondiendo.",
  AI_GATEWAY_CONFIG: "El gateway local de IA no está configurado correctamente.",
  AI_INVALID_JSON: "Qwen devolvió una propuesta inválida. Intenta nuevamente.",
  AI_INVALID_PROPOSAL: "La propuesta de Qwen no pasó las reglas de Video Studio.",
  AMBIGUOUS_CONFIG: "El proyecto tenía campos duplicados de una versión anterior. Vuelve a dirigirlo.",
  UNSAFE_BRIEF: "El brief parece contener una credencial o secreto.",
  VIDEO_STUDIO_TIMEOUT: "Video Studio excedió el tiempo de respuesta.",
  VIDEO_STUDIO_UNAVAILABLE: "Video Studio no está disponible en este servidor.",
};

function friendlyError(code: unknown) {
  return ERROR_LABELS[String(code || "")] || "No se pudo completar la operación.";
}

function idempotency(prefix: string) {
  const value =
    globalThis.crypto?.randomUUID?.() ||
    String(Date.now()) + "-" + String(Math.random());
  return (prefix + "-" + value).replace(/[^A-Za-z0-9._:-]/g, "-");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return String(Math.max(1, Math.round(bytes / 1024))) + " KB";
  }
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function statusTone(status: string): "slate" | "green" | "amber" | "red" | "blue" | "dark" {
  if (status === "completed") return "green";
  if (status === "failed" || status === "cancelled") return "red";
  if (status === "rendering") return "blue";
  if (status === "queued" || status === "validated") return "amber";
  return "slate";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Borrador",
    validated: "Validado",
    queued: "En cola",
    rendering: "Procesando",
    completed: "Listo",
    failed: "Falló",
    cancelled: "Cancelado",
  };
  return labels[status] || status;
}

function cloneConfig(project: VideoProject) {
  return structuredClone(project.config || {});
}

function mediaReferences(
  assets: VideoAsset[],
  introAssetId: string,
  outroAssetId: string,
  logoAssetId: string,
) {
  const reservedVideos = new Set(
    [introAssetId, outroAssetId].filter(Boolean),
  );
  const reservedImages = new Set([logoAssetId].filter(Boolean));
  return {
    images: assets
      .filter(
        (asset) =>
          asset.assetType === "image" && !reservedImages.has(asset.id),
      )
      .map((asset) => "asset:" + asset.id),
    videos: assets
      .filter(
        (asset) =>
          asset.assetType === "video" && !reservedVideos.has(asset.id),
      )
      .map((asset) => "asset:" + asset.id),
  };
}

function assetId(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("asset:")) return "";
  return value.slice(6);
}

export default function AdminVideosPage() {
  const router = useRouter();
  const previewUrlRef = useRef<string | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewPlaybackError, setPreviewPlaybackError] = useState("");

  const [title, setTitle] = useState("Nuevo video");
  const [businessName, setBusinessName] = useState("");
  const [niche, setNiche] = useState("Negocio local");
  const [style, setStyle] = useState("dynamic");
  const [duration, setDuration] = useState(15);
  const [brief, setBrief] = useState("");
  const [createProjectKind, setCreateProjectKind] = useState("external");
  const [createMediaFirst, setCreateMediaFirst] = useState(false);

  const [hook, setHook] = useState("");
  const [secondaryHook, setSecondaryHook] = useState("");
  const [benefit, setBenefit] = useState("");
  const [cta, setCta] = useState("");
  const [analysisConsent, setAnalysisConsent] = useState(false);
  const [directionStatus, setDirectionStatus] = useState("");
  const [projectKind, setProjectKind] = useState("external");
  const [mediaFirst, setMediaFirst] = useState(false);
  const [rightsApproved, setRightsApproved] = useState(false);
  const [introAssetId, setIntroAssetId] = useState("");
  const [outroAssetId, setOutroAssetId] = useState("");
  const [logoAssetId, setLogoAssetId] = useState("");
  const [voiceAssetId, setVoiceAssetId] = useState("");
  const [musicAssetId, setMusicAssetId] = useState("");
  const [useClipAudio, setUseClipAudio] = useState(true);

  const apiJson = useCallback(
    async (body: Record<string, unknown>, key?: string) => {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (key) headers.set("Idempotency-Key", key);
      const response = await adminFetch(
        "/api/admin/videos",
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          cache: "no-store",
        },
        90000,
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; code?: string; error?: string; [key: string]: unknown }
        | null;

      if (response.status === 401) {
        router.push("/login?redirectTo=" + encodeURIComponent("/admin/videos"));
        throw new Error("Unauthorized");
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(friendlyError(payload?.code || payload?.error));
      }
      return payload;
    },
    [router],
  );

  const loadProjects = useCallback(async () => {
    const response = await adminFetch("/api/admin/videos?action=list", {
      cache: "no-store",
    });
    if (response.status === 401) {
      router.push("/login?redirectTo=" + encodeURIComponent("/admin/videos"));
      return;
    }
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; projects?: ProjectSummary[] }
      | null;
    if (!response.ok || !payload?.ok) {
      throw new Error("No se pudieron cargar los videos.");
    }
    setProjects(Array.isArray(payload.projects) ? payload.projects : []);
  }, [router]);

  const fetchProject = useCallback(
    async (projectId: string) => {
      const response = await adminFetch(
        "/api/admin/videos?action=project&projectId=" +
          encodeURIComponent(projectId),
        { cache: "no-store" },
      );
      if (response.status === 401) {
        router.push("/login?redirectTo=" + encodeURIComponent("/admin/videos"));
        return null;
      }
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; project?: VideoProject; code?: string }
        | null;
      if (!response.ok || !payload?.ok || !payload.project) {
        throw new Error(friendlyError(payload?.code));
      }
      return payload.project;
    },
    [router],
  );

  const createPolicyStatus = useMediaFirstStatus(mediaFirstDraft(brief, createProjectKind, createMediaFirst), apiJson);
  const editPolicyStatus = useMediaFirstStatus(project ? mediaFirstDraft(brief, projectKind, mediaFirst) : null, apiJson);

  const syncEditor = useCallback((next: VideoProject) => {
    const content =
      next.config.content && typeof next.config.content === "object"
        ? (next.config.content as Record<string, unknown>)
        : {};
    setHook(String(content.hook || next.config.hook || ""));
    setSecondaryHook(
      String(content.secondaryHook || next.config.secondaryHook || ""),
    );
    setBenefit(String(content.benefit || ""));
    setCta(String(content.cta || next.config.cta || ""));
    const projectMeta =
      next.config.project && typeof next.config.project === "object"
        ? (next.config.project as Record<string, unknown>)
        : {};
    if (typeof projectMeta.creativeBrief === "string") {
      setBrief(projectMeta.creativeBrief);
    }
    if (
      typeof projectMeta.category === "string" &&
      projectMeta.category.trim()
    ) {
      setNiche(projectMeta.category);
    }

    const media =
      next.config.media && typeof next.config.media === "object"
        ? (next.config.media as Record<string, unknown>)
        : {};
    const brand =
      next.config.brand && typeof next.config.brand === "object"
        ? (next.config.brand as Record<string, unknown>)
        : {};
    const creator =
      next.config.creator && typeof next.config.creator === "object"
        ? (next.config.creator as Record<string, unknown>)
        : {};

    setIntroAssetId(assetId(media.creatorIntro));
    setOutroAssetId(assetId(media.creatorOutro));
    setLogoAssetId(assetId(brand.logo));
    setVoiceAssetId(
      assetId(media.clientVoiceover || media.creatorVoiceover),
    );
    setMusicAssetId(assetId(media.backgroundMusic));
    setUseClipAudio(creator.useClipAudio !== false);
    setRightsApproved(next.config.mediaApproved === true);
    setAnalysisConsent(false);
    setProjectKind(next.config.videoType === "website_showcase" ? "website_showcase" : projectMeta.productContext === "citaya-agendas" ? "citaya-agendas" : "external");
    setMediaFirst(structuredMediaFirst(next.config));
  }, []);

  const loadPreview = useCallback(async (next: VideoProject) => {
    const previewJob = next.jobs.find(
      (job) => job.mode === "preview" && job.status === "completed",
    );
    if (!previewJob) return;
    const output = next.outputs.find(
      (item) => item.jobId === previewJob.id && item.outputType === "video",
    );
    if (!output) return;

    const response = await adminFetch(
      "/api/admin/videos?action=download&outputId=" +
        encodeURIComponent(output.id),
      { cache: "no-store" },
      120000,
    );
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) {
      setPreviewPlaybackError("El preview llegó vacío desde el servidor.");
      return;
    }
    const blob = new Blob([bytes], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewPlaybackError("");
    setPreviewUrl(url);
  }, []);

  const selectProject = useCallback(
    async (projectId: string) => {
      const next = await fetchProject(projectId);
      if (!next) return null;
      setProject(next);
      syncEditor(next);
      await loadPreview(next);
      return next;
    },
    [fetchProject, loadPreview, syncEditor],
  );

  useEffect(() => {
    void (async () => {
      try {
        await loadProjects();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "No se pudo cargar Video Studio.",
        );
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, [loadProjects]);

  const activeJob = project?.jobs.find(
    (job) => job.status === "queued" || job.status === "rendering",
  );

  useEffect(() => {
    if (!project?.id || !activeJob) return;
    const projectId = project.id;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          await selectProject(projectId);
          await loadProjects();
        } catch {
          // Polling is best-effort. The manual refresh button remains available.
        }
      })();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeJob, loadProjects, project?.id, selectProject]);

  const latestPreview = useMemo(
    () =>
      project?.jobs.find(
        (job) => job.mode === "preview" && job.status === "completed",
      ) || null,
    [project],
  );

  const latestFinal = useMemo(
    () =>
      project?.jobs.find(
        (job) => job.mode === "final" && job.status === "completed",
      ) || null,
    [project],
  );

  const finalOutput = useMemo(() => {
    if (!project || !latestFinal) return null;
    return (
      project.outputs.find(
        (output) =>
          output.jobId === latestFinal.id && output.outputType === "video",
      ) || null
    );
  }, [latestFinal, project]);

  const previewApproved = Boolean(
    project &&
      latestPreview &&
      project.approvedPreviewJobIds.includes(latestPreview.id),
  );

  async function createFromBrief() {
    if (!businessName.trim() || !brief.trim()) {
      setError("Escribe el nombre del negocio y qué video quieres crear.");
      return;
    }
    setWorking("create");
    setError("");
    try {
      const payload = await apiJson({
        action: "create_from_brief",
        title: title.trim() || "Nuevo video",
        businessName: businessName.trim(),
        niche:
          NICHES.find(
            ([id, label]) =>
              id.toLowerCase() === niche.trim().toLowerCase() ||
              label.toLowerCase() === niche.trim().toLowerCase(),
          )?.[0] || "local-business",
        nicheLabel: niche.trim(),
        style,
        durationSeconds: duration,
        videoType: createProjectKind === "website_showcase" ? "website_showcase" : "promotion",
        productContext: createProjectKind === "citaya-agendas" ? "citaya-agendas" : "external",
        mediaPolicy: mediaFirstPolicy({ videoType: createProjectKind }, createMediaFirst),
        brief: brief.trim(),
      });
      const created = payload.project as VideoProject;
      await loadProjects();
      await selectProject(created.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo crear el video.",
      );
    } finally {
      setWorking("");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!project || !files?.length) return;
    setWorking("upload");
    setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("action", "upload");
        form.set("projectId", project.id);
        form.set("file", file);
        const response = await adminFetch(
          "/api/admin/videos",
          { method: "POST", body: form, cache: "no-store" },
          120000,
        );
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; code?: string }
          | null;
        if (!response.ok || !payload?.ok) {
          throw new Error(friendlyError(payload?.code));
        }
      }
      setRightsApproved(false);
      await selectProject(project.id);
      await loadProjects();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudieron subir los archivos.",
      );
    } finally {
      setWorking("");
    }
  }

  async function saveConfig() {
    if (!project) throw new Error("Selecciona un proyecto.");

    const config = cloneConfig(project);
    const existingContent =
      config.content && typeof config.content === "object"
        ? (config.content as Record<string, unknown>)
        : {};
    const existingMedia =
      config.media && typeof config.media === "object"
        ? (config.media as Record<string, unknown>)
        : {};
    const existingCreator =
      config.creator && typeof config.creator === "object"
        ? (config.creator as Record<string, unknown>)
        : {};
    const existingBrand =
      config.brand && typeof config.brand === "object"
        ? (config.brand as Record<string, unknown>)
        : {};
    const existingAudio =
      config.audio && typeof config.audio === "object"
        ? (config.audio as Record<string, unknown>)
        : {};
    const existingTts =
      existingAudio.tts && typeof existingAudio.tts === "object"
        ? (existingAudio.tts as Record<string, unknown>)
        : {};
    const refs = mediaReferences(
      project.assets,
      introAssetId,
      outroAssetId,
      logoAssetId,
    );
    const voiceoverStart =
      introAssetId && config.timing && typeof config.timing === "object"
        ? Number((config.timing as Record<string, unknown>).intro || 0)
        : 0;

    config.content = {
      ...existingContent,
      hook: hook.trim(),
      secondaryHook: secondaryHook.trim(),
      benefit: benefit.trim(),
      cta: cta.trim(),
    };
    const existingProjectMeta =
      config.project && typeof config.project === "object"
        ? (config.project as Record<string, unknown>)
        : {};
    config.project = {
      ...existingProjectMeta,
      category: niche.trim() || "Negocio local",
      creativeBrief: brief.trim(),
      productContext: projectKind === "citaya-agendas" ? "citaya-agendas" : "external",
    };
    config.videoType = projectKind === "website_showcase" ? "website_showcase" : "promotion";
    config.mediaPolicy = mediaFirstPolicy(config, mediaFirst);
    config.brand = {
      ...existingBrand,
      logo: logoAssetId ? "asset:" + logoAssetId : null,
    };
    config.media = {
      ...existingMedia,
      images: refs.images,
      videos: refs.videos,
      creatorIntro: introAssetId ? "asset:" + introAssetId : null,
      creatorOutro: outroAssetId ? "asset:" + outroAssetId : null,
      clientVoiceover: voiceAssetId ? "asset:" + voiceAssetId : null,
      creatorVoiceover: null,
      backgroundMusic: musicAssetId ? "asset:" + musicAssetId : null,
    };
    config.creator = {
      ...existingCreator,
      useClipAudio,
      voiceoverStart,
    };
    config.audio = {
      ...existingAudio,
      music: Boolean(musicAssetId),
      sfx: false,
      duckMusicDuringVoice: Boolean(
        musicAssetId && (voiceAssetId || existingTts.enabled === true),
      ),
    };
    config.mediaApproved = project.assets.length > 0 ? rightsApproved : false;

    const payload = await apiJson({
      action: "update",
      projectId: project.id,
      config,
    });
    const updated = payload.project as VideoProject;
    setProject(updated);
    syncEditor(updated);
    return updated;
  }

  async function directWithAi() {
    if (!project || !brief.trim()) {
      setError("Escribe el brief creativo antes de dirigir el video.");
      return;
    }
    if (project.assets.length > 0 && !rightsApproved) {
      setError("Confirma que revisaste y puedes usar los medios antes de dirigir.");
      return;
    }

    setWorking("direct");
    setError("");
    try {
      const payload = await directAfterAnalysis({
        save: saveConfig, request: apiJson, projectId: project.id,
        brief: brief.trim(), analysisConsent, onStatus: setDirectionStatus,
      });
      setDirectionStatus("Montaje listo para preview.");
      const directed = payload.project as VideoProject;
      setProject(directed);
      syncEditor(directed);
      await loadProjects();
    } catch (caught) {
      setDirectionStatus("");
      setError(
        caught instanceof Error
          ? caught.message
          : "El Director IA no pudo crear el montaje.",
      );
    } finally {
      setWorking("");
    }
  }

  async function saveCopy() {
    if (!project) return;
    setWorking("save");
    setError("");
    try {
      await saveConfig();
      await loadProjects();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar.");
    } finally {
      setWorking("");
    }
  }

  async function requestPreview() {
    if (!project) return;
    if (project.assets.length > 0 && !rightsApproved) {
      setError("Confirma que revisaste y puedes usar los medios subidos.");
      return;
    }

    setWorking("preview");
    setError("");
    try {
      await saveConfig();
      await apiJson(
        { action: "preview", projectId: project.id },
        idempotency("preview"),
      );
      await selectProject(project.id);
      await loadProjects();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo generar el preview.",
      );
    } finally {
      setWorking("");
    }
  }

  async function approvePreview() {
    if (!project || !latestPreview) return;
    setWorking("approve");
    setError("");
    try {
      await apiJson({ action: "approve", previewJobId: latestPreview.id });
      await selectProject(project.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo aprobar el preview.",
      );
    } finally {
      setWorking("");
    }
  }

  async function requestFinal() {
    if (!project) return;
    setWorking("final");
    setError("");
    try {
      await apiJson(
        { action: "final", projectId: project.id },
        idempotency("final"),
      );
      await selectProject(project.id);
      await loadProjects();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo generar el final.",
      );
    } finally {
      setWorking("");
    }
  }

  async function downloadFinal() {
    if (!project || !finalOutput) return;
    setWorking("download");
    setError("");
    try {
      const response = await adminFetch(
        "/api/admin/videos?action=download&outputId=" +
          encodeURIComponent(finalOutput.id),
        { cache: "no-store" },
        180000,
      );
      if (!response.ok) throw new Error("No se pudo descargar el MP4.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = project.title + ".mp4";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo descargar el MP4.",
      );
    } finally {
      setWorking("");
    }
  }

  async function refreshSelected() {
    if (!project) return;
    setWorking("refresh");
    setError("");
    try {
      await selectProject(project.id);
      await loadProjects();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar.");
    } finally {
      setWorking("");
    }
  }

  return (
    <AdminPageShell width="wide">
      <AdminNav />

      <div className="space-y-5">
        <AdminPageHeader
          eyebrow="Citaya Video Studio · privado"
          title="Videos"
          description="Sube clips e imágenes, crea el copy con Qwen local, revisa un preview y genera el MP4 final."
          actions={
            <StatusBadge tone={activeJob ? "blue" : "green"}>
              {activeJob ? "Procesando" : "Studio listo"}
            </StatusBadge>
          }
        />

        {error ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="grid min-w-0 gap-4 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <AdminSectionCard
              title="Crear video"
              description="Qwen propone el copy. Tú controlas y apruebas los medios."
            >
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs font-black text-slate-600">
                  Nombre del proyecto
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={100}
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-950 outline-none focus:border-blue-400"
                  />
                </label>

                <label className="grid gap-1 text-xs font-black text-slate-600">
                  Negocio / marca
                  <input
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    maxLength={45}
                    placeholder="Ej. HDR Barber Studio"
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-950 outline-none focus:border-blue-400"
                  />
                </label>

                <label className="grid gap-1 text-xs font-black text-slate-600">
                  Rubro
                  <input
                    value={niche}
                    onChange={(event) => setNiche(event.target.value)}
                    list="video-studio-niches"
                    maxLength={60}
                    placeholder="Ej. Barbería, veterinaria, software para reservas..."
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950 outline-none focus:border-blue-400"
                  />
                  <datalist id="video-studio-niches">
                    {NICHES.map(([id, label]) => (
                      <option key={id} value={label} />
                    ))}
                  </datalist>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs font-black text-slate-600">
                    Estilo
                    <select
                      value={style}
                      onChange={(event) => setStyle(event.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                    >
                      <option value="minimal">Minimal</option>
                      <option value="dynamic">Dinámico</option>
                      <option value="premium">Premium</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-xs font-black text-slate-600">
                    Duración
                    <select
                      value={duration}
                      onChange={(event) => setDuration(Number(event.target.value))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                    >
                      <option value={10}>10 s</option>
                      <option value={15}>15 s</option>
                      <option value={20}>20 s</option>
                      <option value={30}>30 s</option>
                    </select>
                  </label>
                </div>

                <label className="grid gap-1 text-xs font-black text-slate-600">
                  Contenido del proyecto
                  <select value={createProjectKind} disabled={Boolean(working)} onChange={(event) => setCreateProjectKind(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950">
                    <option value="external">Contenido externo / cliente / portafolio</option>
                    <option value="website_showcase">Showcase de sitio web real</option>
                    <option value="citaya-agendas">Demo del producto CITAYA Agenda</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
                  <input type="checkbox" checked={createMediaFirst || createProjectKind === "website_showcase"}
                    disabled={Boolean(working) || createProjectKind === "website_showcase"}
                    onChange={(event) => setCreateMediaFirst(event.target.checked)} />
                  Usar únicamente los medios proporcionados
                  {createProjectKind === "website_showcase" && " (obligatorio para showcase web)"}
                </label>
                <p role="status" aria-live="polite" className="text-xs font-medium text-blue-800">{createPolicyStatus}</p>

                <label className="grid gap-1 text-xs font-black text-slate-600">
                  ¿Qué video quieres?
                  <textarea
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                    rows={5}
                    maxLength={6000}
                    placeholder="Ej. Muestra el proceso del corte, el resultado final y termina invitando a reservar."
                    className="resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-950 outline-none focus:border-blue-400"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void createFromBrief()}
                  disabled={
                    Boolean(working) || !businessName.trim() || !brief.trim()
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {working === "create" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Crear con Qwen
                </button>
              </div>
            </AdminSectionCard>

            <AdminSectionCard title="Mis videos">
              {loading ? (
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Cargando…
                </div>
              ) : projects.length ? (
                <div className="grid gap-2">
                  {projects.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => { setDirectionStatus(""); void selectProject(item.id); }}
                      className={
                        "rounded-xl border p-3 text-left transition " +
                        (project?.id === item.id
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-slate-50 hover:bg-white")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {item.title}
                        </span>
                        <StatusBadge tone={statusTone(item.status)}>
                          {statusLabel(item.status)}
                        </StatusBadge>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm font-medium text-slate-500">
                  Todavía no has creado videos.
                </div>
              )}
            </AdminSectionCard>
          </div>

          {!project ? (
            <AdminSectionCard>
              <EmptyState
                icon={Clapperboard}
                title="Crea tu primer video"
                description="Escribe qué quieres mostrar. Después sube tus clips, revisa el copy y genera el preview."
              />
            </AdminSectionCard>
          ) : (
            <div className="grid min-w-0 content-start gap-4">
              <AdminSectionCard
                title={project.title}
                description={
                  String(project.assets.length) +
                  " medios · revisión " +
                  String(project.revision)
                }
                actions={
                  <button
                    type="button"
                    onClick={() => void refreshSelected()}
                    disabled={Boolean(working)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700"
                  >
                    <RefreshCcw
                      className={
                        "h-4 w-4 " +
                        (working === "refresh" ? "animate-spin" : "")
                      }
                    />
                    Actualizar
                  </button>
                }
              >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-xs font-black text-slate-600">
                      Hook
                      <input
                        value={hook}
                        onChange={(event) => setHook(event.target.value)}
                        maxLength={74}
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-black text-slate-600">
                      Segundo mensaje
                      <input
                        value={secondaryHook}
                        onChange={(event) =>
                          setSecondaryHook(event.target.value)
                        }
                        maxLength={90}
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-black text-slate-600">
                      Beneficio
                      <input
                        value={benefit}
                        onChange={(event) => setBenefit(event.target.value)}
                        maxLength={65}
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-black text-slate-600">
                      CTA
                      <input
                        value={cta}
                        onChange={(event) => setCta(event.target.value)}
                        maxLength={40}
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void saveCopy()}
                      disabled={Boolean(working)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      Guardar edición
                    </button>

                    <button
                      type="button"
                      onClick={() => void directWithAi()}
                      disabled={Boolean(working) || !brief.trim()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {working === "direct" ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      Dirigir con IA
                    </button>
                    <label className="grid gap-1 text-xs font-black text-slate-600">
                      Contenido del proyecto
                      <select value={projectKind} disabled={Boolean(working)} onChange={(event) => setProjectKind(event.target.value)}>
                        <option value="external">Contenido externo / cliente / portafolio</option>
                        <option value="website_showcase">Showcase de sitio web real</option>
                        <option value="citaya-agendas">Demo del producto CITAYA Agenda</option>
                      </select>
                    </label>
                    <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <input type="checkbox" checked={mediaFirst || projectKind === "website_showcase"}
                        disabled={Boolean(working) || projectKind === "website_showcase"}
                        onChange={(event) => setMediaFirst(event.target.checked)} />
                      Usar únicamente los medios proporcionados
                      {projectKind === "website_showcase" && " (obligatorio para showcase web)"}
                    </label>
                    <p role="status" aria-live="polite" className="text-xs font-medium text-blue-800">{editPolicyStatus}</p>
                    <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <input type="checkbox" checked={analysisConsent} disabled={Boolean(working)}
                        onChange={(event) => setAnalysisConsent(event.target.checked)} />
                      Autorizo a Qwen Visual local a analizar las imágenes y videos seleccionados de este proyecto. No incluye audio.
                    </label>
                    <p role="status" aria-live="polite" className="text-xs font-bold text-blue-800">{directionStatus}</p>
                    <p className="text-xs font-medium leading-5 text-slate-500">
                      El análisis visual se realiza después de esta autorización; subir archivos no significa que Qwen los haya visto.
                      El Director usa tu brief y las duraciones reales de los medios.
                      Si voz o video no caben en el tiempo objetivo, prioriza no cortarlos.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                      <Upload className="h-4 w-4" />
                      Subir material
                    </div>
                    <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                      Imágenes, videos, voz y música. Los archivos quedan
                      privados y solo se incorporan después de tu confirmación.
                    </p>

                    <label className="mt-3 flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-3 py-3 text-sm font-black text-white">
                      {working === "upload" ? "Subiendo…" : "Elegir archivos"}
                      <input
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.wav,.mp3,.m4a,.ogg"
                        className="sr-only"
                        disabled={Boolean(working)}
                        onChange={(event) => {
                          void uploadFiles(event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>

                    {project.assets.some(
                      (asset) => asset.assetType === "video",
                    ) ? (
                      <div className="mt-4 grid gap-3">
                        <label className="grid gap-1 text-xs font-black text-slate-600">
                          Video de inicio
                          <select
                            value={introAssetId}
                            onChange={(event) =>
                              setIntroAssetId(event.target.value)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                          >
                            <option value="">Sin video de inicio</option>
                            {project.assets
                              .filter((asset) => asset.assetType === "video")
                              .map((asset, index) => (
                                <option key={asset.id} value={asset.id}>
                                  {"Video " + String(index + 1) + " · " + formatBytes(asset.sizeBytes)}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="grid gap-1 text-xs font-black text-slate-600">
                          Video de cierre
                          <select
                            value={outroAssetId}
                            onChange={(event) =>
                              setOutroAssetId(event.target.value)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                          >
                            <option value="">Sin video de cierre</option>
                            {project.assets
                              .filter((asset) => asset.assetType === "video")
                              .map((asset, index) => (
                                <option key={asset.id} value={asset.id}>
                                  {"Video " + String(index + 1) + " · " + formatBytes(asset.sizeBytes)}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="flex items-start gap-2 text-xs font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={useClipAudio}
                            onChange={(event) =>
                              setUseClipAudio(event.target.checked)
                            }
                            className="mt-1"
                          />
                          Conservar el audio original de los clips de inicio/cierre.
                        </label>
                      </div>
                    ) : null}

                    {project.assets.some(
                      (asset) => asset.assetType === "image",
                    ) ? (
                      <div className="mt-4 grid gap-3">
                        <label className="grid gap-1 text-xs font-black text-slate-600">
                          Logo / imagen de marca
                          <select
                            value={logoAssetId}
                            onChange={(event) =>
                              setLogoAssetId(event.target.value)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                          >
                            <option value="">Sin logo</option>
                            {project.assets
                              .filter((asset) => asset.assetType === "image")
                              .map((asset, index) => (
                                <option key={asset.id} value={asset.id}>
                                  {"Imagen " + String(index + 1) + " · " + formatBytes(asset.sizeBytes)}
                                </option>
                              ))}
                          </select>
                        </label>
                        <p className="text-[11px] font-medium leading-4 text-slate-500">
                          El logo seleccionado se reserva para el branding y el cierre; no se usa como b-roll.
                        </p>
                      </div>
                    ) : null}

                    {project.assets.some(
                      (asset) => asset.assetType === "audio",
                    ) ? (
                      <div className="mt-4 grid gap-3">
                        <label className="grid gap-1 text-xs font-black text-slate-600">
                          Voz / narración
                          <select
                            value={voiceAssetId}
                            onChange={(event) =>
                              setVoiceAssetId(event.target.value)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                          >
                            <option value="">Sin voiceover</option>
                            {project.assets
                              .filter((asset) => asset.assetType === "audio")
                              .map((asset, index) => (
                                <option key={asset.id} value={asset.id}>
                                  {"Audio " + String(index + 1) + " · " + formatBytes(asset.sizeBytes)}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="grid gap-1 text-xs font-black text-slate-600">
                          Música de fondo
                          <select
                            value={musicAssetId}
                            onChange={(event) =>
                              setMusicAssetId(event.target.value)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-950"
                          >
                            <option value="">Sin música</option>
                            {project.assets
                              .filter((asset) => asset.assetType === "audio")
                              .map((asset, index) => (
                                <option key={asset.id} value={asset.id}>
                                  {"Audio " + String(index + 1) + " · " + formatBytes(asset.sizeBytes)}
                                </option>
                              ))}
                          </select>
                        </label>

                        {voiceAssetId && musicAssetId ? (
                          <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-900">
                            La música se atenuará automáticamente mientras habla la voz.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {project.assets.length ? (
                      <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
                        <input
                          type="checkbox"
                          checked={rightsApproved}
                          onChange={(event) =>
                            setRightsApproved(event.target.checked)
                          }
                          className="mt-1"
                        />
                        Revisé estos medios, puedo usarlos y no contienen
                        información privada que deba ocultarse.
                      </label>
                    ) : null}
                  </div>
                </div>

                {project.assets.length ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {project.assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        {asset.assetType === "video" ? (
                          <FileVideo2 className="h-5 w-5 text-blue-600" />
                        ) : asset.assetType === "audio" ? (
                          <FileAudio2 className="h-5 w-5 text-violet-600" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-emerald-600" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-900">
                            {asset.assetType === "video"
                              ? "Video"
                              : asset.assetType === "audio"
                                ? "Audio"
                                : "Imagen"}
                          </div>
                          <div className="text-xs font-medium text-slate-500">
                            {formatBytes(asset.sizeBytes)}
                            {asset.durationMs
                              ? " · " +
                                (asset.durationMs / 1000).toFixed(1) +
                                " s"
                              : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </AdminSectionCard>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
                <AdminSectionCard
                  title="Preview"
                  description="720×1280 · debes revisarlo antes del final."
                >
                  {previewUrl ? (
                    <div className="mx-auto max-w-[23rem] overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-lg">
                      <video
                        key={previewUrl}
                        src={previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={() => setPreviewPlaybackError("")}
                        onError={(event) => {
                          const mediaError = event.currentTarget.error;
                          const code = mediaError?.code ?? 0;
                          setPreviewPlaybackError(
                            "Chrome no pudo reproducir el preview (MediaError " +
                              String(code) +
                              ").",
                          );
                        }}
                        className="aspect-[9/16] w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50">
                      <div className="text-center">
                        <Play className="mx-auto h-8 w-8 text-slate-400" />
                        <div className="mt-2 text-sm font-black text-slate-700">
                          Aún no hay preview
                        </div>
                      </div>
                    </div>
                  )}
                  {previewPlaybackError ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
                      {previewPlaybackError}
                    </div>
                  ) : null}
                </AdminSectionCard>

                <AdminSectionCard title="Producción">
                  <div className="grid gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-bold text-slate-500">
                        Estado
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <StatusBadge tone={statusTone(project.status)}>
                          {statusLabel(project.status)}
                        </StatusBadge>
                        {activeJob ? (
                          <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void requestPreview()}
                      disabled={Boolean(working) || Boolean(activeJob)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" />
                      Generar preview
                    </button>

                    <button
                      type="button"
                      onClick={() => void approvePreview()}
                      disabled={
                        Boolean(working) ||
                        !latestPreview ||
                        previewApproved ||
                        Boolean(activeJob)
                      }
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-black text-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {previewApproved
                        ? "Preview aprobado"
                        : "Aprobar preview"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void requestFinal()}
                      disabled={
                        Boolean(working) ||
                        !previewApproved ||
                        Boolean(activeJob)
                      }
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Clapperboard className="h-4 w-4" />
                      Generar final 1080p
                    </button>

                    <button
                      type="button"
                      onClick={() => void downloadFinal()}
                      disabled={Boolean(working) || !finalOutput}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      Descargar MP4
                    </button>
                  </div>
                </AdminSectionCard>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminPageShell>
  );
}
