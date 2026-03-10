import { createContext, useContext, useState, useCallback } from "react";

import { CreateBaseModal } from "~/components/CreateBaseModal";

type CreateBaseModalContextValue = {
  openCreateModal: () => void;
};

const CreateBaseModalContext = createContext<CreateBaseModalContextValue | null>(null);

export function CreateBaseModalProvider({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);

  const openCreateModal = useCallback(() => setShow(true), []);

  return (
    <CreateBaseModalContext.Provider value={{ openCreateModal }}>
      {children}
      {show && (
        <CreateBaseModal
          onClose={() => setShow(false)}
        />
      )}
    </CreateBaseModalContext.Provider>
  );
}

export function useCreateBaseModal() {
  const ctx = useContext(CreateBaseModalContext);
  return ctx;
}
