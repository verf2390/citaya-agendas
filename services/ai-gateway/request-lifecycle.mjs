export function bindDownstreamAbort(req, res, controller) {
  let clientClosed = false;

  const abortForClient = () => {
    if (clientClosed) return;
    clientClosed = true;
    if (!controller.signal.aborted) {
      controller.abort(new Error("Downstream client disconnected"));
    }
  };

  const onRequestAborted = () => {
    abortForClient();
  };

  const onResponseClose = () => {
    if (!res.writableEnded) {
      abortForClient();
    }
  };

  req.once("aborted", onRequestAborted);
  res.once("close", onResponseClose);

  return {
    wasClientClosed() {
      return clientClosed;
    },
    cleanup() {
      req.off("aborted", onRequestAborted);
      res.off("close", onResponseClose);
    },
  };
}

export function canWriteResponse(res) {
  return !res.destroyed && !res.writableEnded;
}
