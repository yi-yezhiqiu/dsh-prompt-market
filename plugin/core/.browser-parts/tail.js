  /* ==== PM-CORE-INLINE:END ==== */

  /* ---------------------------------------------------------------------------
   * 对外公开面
   * ------------------------------------------------------------------------ */
  return {
    ok: true,
    kind: 'dsh-prompt-market-data-layer',
    dataApiMajor: namespace.constants ? namespace.constants.DATA_API_MAJOR : null,
    schemaVersion: namespace.storage ? namespace.storage.CURRENT_SCHEMA : null,
    constants: namespace.constants,
    text: namespace.text,
    filter: namespace.filter,
    storage: namespace.storage,
    normalize: namespace.normalize,
    net: namespace.net,
    sources: namespace.sources,
    api: namespace.api,
    /* 便捷单例（UI 直接用；也可自建隔离实例） */
    get market() {
      return namespace.api ? namespace.api.getShared({}) : null;
    },
    createDataLayer: function (options) {
      return namespace.api.createDataLayer(options || {});
    }
  };
});
