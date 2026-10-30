import React from 'react';
import { RegisterMT5AccountModal } from '../admin/RegisterMT5AccountModal';

interface ConnectParentAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectParentAccountModal: React.FC<ConnectParentAccountModalProps> = ({
  isOpen,
  onClose
}) => {
  return (
    <RegisterMT5AccountModal
      isOpen={isOpen}
      onClose={onClose}
      defaultRole="parent"
      onSuccess={() => {}}
    />
  );
};
