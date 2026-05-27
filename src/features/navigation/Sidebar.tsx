import { ConnectionTree } from '../connections/ConnectionTree';
import { SchemaTree } from '../schema-tree/SchemaTree';

export function Sidebar() {
  return (
    <div className="sidebar-content">
      <div className="sidebar-section">
        <ConnectionTree />
      </div>
      <div className="sidebar-section">
        <SchemaTree />
      </div>
    </div>
  );
}
