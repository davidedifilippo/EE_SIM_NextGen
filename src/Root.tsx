import React from 'react';
import { App } from './App';
import { MobileApp } from './mobile/MobileApp';
import { useLayout } from './ui/layoutChoice';
import { useWorkbench } from './workbench/useWorkbench';

/** One workbench for both layouts, so that changing layout keeps the circuit, its history and the results. */
export const Root: React.FC = () => {
  const wb = useWorkbench();
  const [layout, setLayout] = useLayout();
  return layout === 'phone' ? <MobileApp wb={wb} onFullLayout={() => setLayout('full')} /> : <App wb={wb} onPhoneLayout={() => setLayout('phone')} />;
};
