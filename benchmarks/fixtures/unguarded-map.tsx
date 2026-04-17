type Order = {
  id: string;
  amount: number;
};

type Props = {
  data?: {
    orders?: Order[];
  };
};

export function OrderList({ data }: Props) {
  const total = data.orders.length;

  return (
    <ul>
      {data.orders.map((item) => (
        <li key={item.id}>{item.amount}</li>
      ))}
      <li>Total: {total}</li>
    </ul>
  );
}
