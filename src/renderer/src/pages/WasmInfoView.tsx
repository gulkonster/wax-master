import type { WasmInfo } from '../../../shared/api'

export function WasmInfoView({ rel, info }: { rel: string; info: WasmInfo }): React.JSX.Element {
  const funcs = info.imports.filter((i) => i.kind === 'function')
  return (
    <div className="page-scroll">
      <div className="form-page" style={{ paddingTop: 'var(--sp-8)' }}>
        <h1 className="mono" style={{ fontSize: 'var(--fs-section)' }}>{rel}</h1>
        {!info.valid && <div className="error-text">This file could not be read as a WebAssembly module: {info.error}</div>}
        <div className="field">
          <label>Size</label>
          <div className="chip">{info.size.toLocaleString()} bytes</div>
        </div>
        <div className="field">
          <label>SHA-256</label>
          <div className="chip" style={{ userSelect: 'text' }}>{info.sha256}</div>
        </div>
        <div className="field">
          <label>Exports</label>
          <div className="chip">{info.exports.join(', ') || '(none)'}</div>
        </div>
        <div className="field">
          <label>Imported functions ({funcs.length})</label>
          <div className="wasm-imports">
            {funcs.map((f) => (
              <div key={`${f.module}.${f.name}`}>
                <span style={{ color: 'var(--text-3)' }}>{f.module}.</span>
                {f.name}
              </div>
            ))}
          </div>
          <div className="hint">These are the host functions the contract calls. Before deploying, they are checked against the features active on the selected chain.</div>
        </div>
      </div>
    </div>
  )
}
