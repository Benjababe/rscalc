/** Small table/stat building blocks shared by the two result pages. */

export function Th(props: {
  label: string;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  right?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <th
      className={props.right ? "right sortable" : "sortable"}
      title={props.title}
    >
      <button type="button" onClick={props.onClick}>
        {props.label}
        {props.active && (
          <span className="arrow">{props.desc ? "▾" : "▴"}</span>
        )}
      </button>
    </th>
  );
}

export function Stat(props: {
  label: string;
  value: string;
  accent?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <div
      className={props.accent ? "stat accent" : "stat"}
      title={props.title}
    >
      <span className="label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
