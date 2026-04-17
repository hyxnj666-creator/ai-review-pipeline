import { useState } from 'react';

type Props = {
  pay: () => Promise<void>;
};

export function PayButton({ pay }: Props) {
  const [success, setSuccess] = useState(false);

  async function handleClick() {
    pay();
    setSuccess(true);
  }

  return (
    <button onClick={handleClick}>
      {success ? 'Paid' : 'Pay now'}
    </button>
  );
}
