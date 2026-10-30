import React from 'react';
import { RegisterMT5AccountModal } from '../admin/RegisterMT5AccountModal';

interface ConnectChildAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectChildAccountModal: React.FC<ConnectChildAccountModalProps> = ({
  isOpen,
  onClose
}) => {
  return (
    <RegisterMT5AccountModal
      isOpen={isOpen}
      onClose={onClose}
      defaultRole="child"
      onSuccess={() => {}}
    />
  );
};
