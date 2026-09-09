import { createContext, useContext, useState } from 'react';
import { AuthContext } from './AuthContext.jsx';
import { assignedRoles, workspaces } from './workspaces.js';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user } = useContext(AuthContext);
  const roles = assignedRoles(user);
  const [selection, setSelection] = useState(null);
  const role = selection && user && selection.userId === user.id && roles.includes(selection.role) ? selection.role : roles[0];
  const selectRole = (next) => {
    if (roles.includes(next)) setSelection({ userId: user?.id, role: next });
  };
  return <WorkspaceContext.Provider value={{ role, roles, workspace: workspaces[role], selectRole }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() { return useContext(WorkspaceContext); }
