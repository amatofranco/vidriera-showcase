import { useEffect, useState } from "react";
import type { AuthState } from "@/lib/auth-context";
import {
  CatalogGenerationCancelledError,
  cancelCatalogGenerationJob,
  generateCatalog,
  getActiveCatalogGenerationJob,
  getCurrentCatalog,
  pollCatalogGenerationJob,
  type CatalogGenerationProgress,
  type GenerateCatalogResult,
  type Item,
} from "@/lib/api";
import { Messages, apiErrorMessage, missingPricesHint } from "@/lib/messages";

const SHOW_PRICES_STORAGE_PREFIX = "vidriera-admin-show-prices-";

function loadShowPrices(companyId: string): boolean {
  try {
    return localStorage.getItem(SHOW_PRICES_STORAGE_PREFIX + companyId) === "true";
  } catch {
    return false;
  }
}

export function useCatalogGeneration({
  auth,
  items,
  setError,
  waitForPendingStockWrites,
}: {
  auth: AuthState | null;
  items: Item[];
  setError: (message: string | null) => void;
  waitForPendingStockWrites: () => Promise<void>;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [catalogResult, setCatalogResult] = useState<GenerateCatalogResult | null>(null);
  const [generationProgress, setGenerationProgress] = useState<CatalogGenerationProgress | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [generationSucceeded, setGenerationSucceeded] = useState(false);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);

  const selectableCount = items.filter((p) => p.hasStock && p.hasSheet).length;
  const missingPriceCount = items.filter((p) => p.hasStock && p.hasSheet && p.price == null).length;

  useEffect(() => {
    if (!auth) return;
    getCurrentCatalog(auth.token)
      .then((result) => setCatalogResult(result))
      .catch(() => {});
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setShowPrices(loadShowPrices(auth.companyId));

    getActiveCatalogGenerationJob(auth.token)
      .then((job) => {
        if (!job || (job.status !== "Pending" && job.status !== "Running")) return;

        setIsGenerating(true);
        setActiveJobId(job.jobId);
        setGenerationProgress(null);
        pollCatalogGenerationJob(auth.token, job.jobId, setGenerationProgress)
          .then((result) => {
            setCatalogResult(result);
            setGenerationSucceeded(true);
          })
          .catch((err) => handleGenerationError(err))
          .finally(() => finishGeneration());
      })
      .catch(() => {});
  }, [auth]);

  function finishGeneration() {
    setIsGenerating(false);
    setGenerationProgress(null);
    setActiveJobId(null);
    setIsCancelling(false);
    setCancelError(null);
  }

  function handleGenerationError(err: unknown) {
    if (err instanceof CatalogGenerationCancelledError) {
      const message = err.message || Messages.catalogGenerationCancelled;
      setGenerationNotice(message);
      setCancelledMessage(message);
      if (auth) {
        getCurrentCatalog(auth.token)
          .then((result) => setCatalogResult(result))
          .catch(() => {});
      }
      return;
    }
    setError(apiErrorMessage(err, Messages.catalogGenerationFailed));
  }

  async function handleCancelGeneration() {
    if (!auth || !activeJobId || isCancelling) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancelCatalogGenerationJob(auth.token, activeJobId);
    } catch (err) {
      setIsCancelling(false);
      setCancelError(apiErrorMessage(err, Messages.catalogGenerationCancelFailed));
    }
  }

  function handleToggleShowPrices() {
    setShowPrices((prev) => {
      const next = !prev;
      if (auth) {
        try {
          localStorage.setItem(SHOW_PRICES_STORAGE_PREFIX + auth.companyId, String(next));
        } catch {
        }
      }
      return next;
    });
  }

  async function handleGenerateCatalog() {
    if (!auth) return;
    if (selectableCount === 0) return;
    if (showPrices && missingPriceCount > 0) {
      setError(missingPricesHint(missingPriceCount));
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGenerationNotice(null);
    setCancelledMessage(null);
    setCatalogResult(null);
    setGenerationProgress(null);
    try {
      await waitForPendingStockWrites();
      const result = await generateCatalog(auth.token, setGenerationProgress, showPrices, setActiveJobId);
      setCatalogResult(result);
      setGenerationSucceeded(true);
    } catch (err) {
      handleGenerationError(err);
    } finally {
      finishGeneration();
    }
  }

  return {
    isGenerating,
    catalogResult,
    generationProgress,
    selectableCount,
    showPrices,
    handleToggleShowPrices,
    missingPriceCount,
    handleGenerateCatalog,
    canCancelGeneration: activeJobId !== null,
    isCancelling,
    cancelError,
    generationNotice,
    handleCancelGeneration,
    generationSucceeded,
    dismissGenerationSucceeded: () => setGenerationSucceeded(false),
    cancelledMessage,
    dismissCancelledMessage: () => setCancelledMessage(null),
  };
}
