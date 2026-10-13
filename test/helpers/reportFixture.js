module.exports = {
  order: { id: 100, order_id: '00100', grand_total: '125.00', item_total: '100.00', customer_email: 'fixture@example.com' },
  line_items: [
    { id: 7, quantity: 3, name: 'Plaque', final_sku: 'same-sku', product_options: [{ option_name: 'Finish', sub_option_name: 'Matte' }] },
    { id: 8, quantity: 2, name: 'Plaque', final_sku: 'same-sku', product_options: [{ option_name: 'Finish', sub_option_name: 'Glossy' }, { key: 'New Key', value: 'Late Value' }] },
  ],
  shipments: [
    { id: 'a', tracking_number: '0000123', ship_date: '2026-02-02', line_items: [{ id: 7, quantity: 1 }], line_item_ids: [7] },
    { id: 'b', tracking_number: '0000456', ship_date: '2026-02-01', line_items: [{ id: 7, quantity: 2 }, { id: 8, quantity: 2 }] },
  ],
};
