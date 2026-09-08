/** The accessibility relief every chart ships alongside its SVG: a plain
 * table of the same data, toggled by the "Table" button in the chart header. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={`sticky top-0 border-b border-hairline bg-surface py-1.5 px-2 font-semibold text-ink-secondary ${
                  i === 0 ? "text-left" : "text-right tabular-nums"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`border-b border-hairline py-1.5 px-2 ${
                    ci === 0 ? "text-left" : "text-right tabular-nums"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
