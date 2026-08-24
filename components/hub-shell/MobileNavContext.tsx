'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type MobileNavContextType = {
  isOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
};

const MobileNavContext = createContext<MobileNavContextType>({
  isOpen: false,
  openMobileNav: () => {},
  closeMobileNav: () => {},
  toggleMobileNav: () => {},
});

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <MobileNavContext.Provider
      value={{
        isOpen,
        openMobileNav: () => setIsOpen(true),
        closeMobileNav: () => setIsOpen(false),
        toggleMobileNav: () => setIsOpen((prev) => !prev),
      }}
    >
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}
