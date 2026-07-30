import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatMoney, toMemberMessage, type Database } from '@mvmnt/shared';
import { useToast } from '../components/Toast';
import { mediaUrl, uploadMedia } from '../lib/media';
import { useConfirm } from '../components/Confirm';

type Product = Database['public']['Tables']['products']['Row'];
type Order = Database['public']['Tables']['orders']['Row'] & {
  buyer: { display_name: string } | null;
  recipient: { display_name: string } | null;
};

/**
 * The shop, from the club's side.
 *
 * Two jobs that look separate and are not: keeping the catalogue right, and
 * getting things into people's hands. An organiser standing at a run with a box
 * of shirts needs the second one, so the order queue is the top half of this
 * screen rather than buried under product editing.
 */
export function Merch() {
  const toast = useToast();
  const confirm = useConfirm();

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [sizes, setSizes] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    const [items, rows] = await Promise.all([
      supabase.from('products').select('*').order('sort_order'),
      supabase
        .from('orders')
        .select('*, buyer:buyer_id(display_name), recipient:recipient_id(display_name)')
        .neq('status', 'cancelled')
        .neq('status', 'fulfilled')
        .order('created_at', { ascending: true }),
    ]);
    if (items.error) toast.error("Couldn't load the catalogue", toMemberMessage(items.error));
    setProducts(items.data ?? []);
    setOrders((rows.data ?? []) as Order[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function addProduct() {
    const priceMajor = Number.parseFloat(price);
    if (!name.trim() || !Number.isFinite(priceMajor) || priceMajor < 0) {
      toast.error('Name and price are needed', 'Price in EGP, e.g. 450 or 450.50');
      return;
    }

    setBusy(true);

    // The image first, so a failed upload never leaves a product without the
    // photo the organiser thought they attached. Stored as a PATH — the
    // blank-shop-on-a-phone bug was absolute URLs in this column.
    let imagePath: string | null = null;
    if (imageFile) {
      const uploaded = await uploadMedia(imageFile, `products/${crypto.randomUUID()}`);
      if ('error' in uploaded) {
        setBusy(false);
        toast.error("Couldn't upload the photo", uploaded.error);
        return;
      }
      imagePath = uploaded.path;
    }

    const { error } = await supabase.from('products').insert({
      name: name.trim(),
      image_url: imagePath,
      description: description.trim() || null,
      // Stored in piastres. Rounding here rather than letting a float through:
      // 450.1 * 100 is 45009.999… in binary floating point.
      price_minor: Math.round(priceMajor * 100),
      stock: stock.trim() === '' ? null : Math.max(0, Number.parseInt(stock, 10) || 0),
      sizes: sizes.trim()
        ? sizes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        : [],
      status: 'coming_soon',
    });
    setBusy(false);

    if (error) {
      toast.error("Couldn't add that item", toMemberMessage(error));
      return;
    }
    toast.success(`${name.trim()} added`, 'It is “coming soon” until you put it on sale.');
    setName('');
    setImageFile(null);
    setPrice('');
    setStock('');
    setSizes('');
    setDescription('');
    load();
  }

  async function changePhoto(product: Product, file: File) {
    const uploaded = await uploadMedia(file, `products/${product.id}`);
    if ('error' in uploaded) {
      toast.error("Couldn't upload the photo", uploaded.error);
      return;
    }
    const { error } = await supabase
      .from('products')
      .update({ image_url: uploaded.path })
      .eq('id', product.id);
    if (error) {
      toast.error("Couldn't save the photo", toMemberMessage(error));
      return;
    }
    toast.success(`${product.name} has a new photo`);
    load();
  }

  async function setStatus(product: Product, status: Product['status']) {
    const { error } = await supabase.from('products').update({ status }).eq('id', product.id);
    if (error) {
      toast.error("Couldn't change that", toMemberMessage(error));
      return;
    }
    toast.success(
      status === 'in_stock'
        ? `${product.name} is on sale`
        : status === 'coming_soon'
          ? `${product.name} is back to coming soon`
          : `${product.name} is off the shop`,
    );
    load();
  }

  async function adjustStock(product: Product, delta: number) {
    if (product.stock === null) return;
    const next = Math.max(0, product.stock + delta);
    // Restocking a sold-out item puts it back on sale in the same motion —
    // an organiser adding stock means "we have more", not "we have more but
    // keep hiding it".
    const patch: { stock: number; status?: 'in_stock' } =
      next > 0 && product.status === 'sold_out' ? { stock: next, status: 'in_stock' } : { stock: next };
    const { error } = await supabase.from('products').update(patch).eq('id', product.id);
    if (error) {
      toast.error("Couldn't update stock", toMemberMessage(error));
      return;
    }
    // Say it happened. These were the only mutating controls in the console
    // with no feedback beyond a number changing in a busy table (audit).
    toast.success(
      `${product.name}: ${next} in stock` +
        (next > 0 && product.status === 'sold_out' ? ' — back on sale' : ''),
    );
    load();
  }

  async function advance(order: Order, status: 'paid' | 'ready' | 'fulfilled') {
    if (status === 'paid') {
      const ok = await confirm({
        title: 'Mark this as paid?',
        message:
          'There is no payment gateway wired in yet, so this is you confirming the member has ' +
          'actually paid the club.\n\nIf it is a gift, the recipient is notified the moment you do.',
        confirmLabel: 'They have paid',
      });
      if (!ok) return;

      // The real function: an organiser recording that cash changed hands.
      // The dev stand-in this used to call refuses to run on production, which
      // made every real "Mark paid" click an error (audit finding #1).
      const { error } = await supabase.rpc('admin_mark_paid', { p_order_id: order.id });
      if (error) {
        toast.error("Couldn't mark that paid", toMemberMessage(error));
        return;
      }
      toast.success('Marked paid', order.is_gift ? 'The recipient has been told.' : undefined);
      load();
      return;
    }

    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id);
    if (error) {
      toast.error("Couldn't update that order", toMemberMessage(error));
      return;
    }
    toast.success(status === 'ready' ? 'Ready to collect' : 'Handed over');
    load();
  }

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Merch</h2>
          <p className="subtitle">The catalogue, and what needs handing over.</p>
        </div>
      </div>

      <div className="notice info">
        <strong>No payments are taken in the app.</strong> Members reserve an item and pay the club
        in person; you mark it paid here. Wiring a real gateway is a Phase 3 decision waiting on
        quotes — see <code>docs/costs.md</code>.
      </div>

      <div className="card">
        <h3 className="section-title">To hand over ({orders.length})</h3>
        {orders.length === 0 ? (
          <div className="empty">Nothing outstanding.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Who</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right' }}>Owed</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {o.product_name}
                      {o.quantity > 1 ? ` × ${o.quantity}` : ''}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {o.is_gift ? (
                        <>
                          {o.recipient?.display_name ?? 'Former member'}
                          <div style={{ color: 'var(--muted)' }}>
                            gift from {o.buyer?.display_name ?? 'a former member'}
                          </div>
                        </>
                      ) : (
                        (o.buyer?.display_name ?? 'Former member')
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {o.size ?? '—'}
                      {/* A gift with no confirmed size cannot be handed over
                          yet — the recipient has not said what they want. */}
                      {o.is_gift && !o.redeemed_at && (
                        <div style={{ color: 'var(--alert)' }}>not confirmed</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(o.total_minor, o.currency)}
                      {o.points_spent > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          −{o.points_spent.toLocaleString()} pts
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${o.status === 'ready' ? 'published' : ''}`}>
                        {o.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {o.status === 'awaiting_payment' && (
                        <button className="link" onClick={() => advance(o, 'paid')}>
                          Mark paid
                        </button>
                      )}
                      {o.status === 'paid' && (
                        <button
                          className="link"
                          onClick={() => advance(o, 'ready')}
                          disabled={o.is_gift && !o.redeemed_at}
                          title={
                            o.is_gift && !o.redeemed_at
                              ? 'Waiting for the recipient to confirm their size'
                              : undefined
                          }
                        >
                          Ready
                        </button>
                      )}
                      {o.status === 'ready' && (
                        <button className="link" onClick={() => advance(o, 'fulfilled')}>
                          Handed over
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Catalogue</h3>
        {products.length === 0 ? (
          <div className="empty">Nothing in the shop yet.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* The photo is editable here because "change the tee's
                            picture" is a Tuesday-evening job, and a console
                            that needs a developer for it fails its whole
                            purpose. */}
                        <label
                          title={mediaUrl(p.image_url) ? 'Change photo' : 'Add photo'}
                          style={{ cursor: 'pointer' }}
                        >
                          {mediaUrl(p.image_url) ? (
                            <img
                              src={mediaUrl(p.image_url)!}
                              alt=""
                              style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }}
                            />
                          ) : (
                            <span
                              style={{
                                width: 44, height: 44, borderRadius: 8,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--sunken)', color: 'var(--muted)', fontSize: 11,
                              }}
                            >
                              + photo
                            </span>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) changePhoto(p, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <div>
                          {p.name}
                          {p.sizes.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {p.sizes.join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(p.price_minor, p.currency)}
                    </td>
                    <td>
                      {p.stock === null ? (
                        <span style={{ color: 'var(--muted)' }}>not tracked</span>
                      ) : (
                        <span className="inline">
                          <button className="link" onClick={() => adjustStock(p, -1)}>
                            −
                          </button>
                          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{p.stock}</strong>
                          <button className="link" onClick={() => adjustStock(p, 1)}>
                            +
                          </button>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${p.status === 'in_stock' ? 'published' : p.status === 'retired' ? 'cancelled' : 'draft'}`}>
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.status !== 'in_stock' && (
                        <button className="link" onClick={() => setStatus(p, 'in_stock')} style={{ marginRight: 10 }}>
                          Put on sale
                        </button>
                      )}
                      {p.status !== 'retired' && (
                        <button className="link" onClick={() => setStatus(p, 'retired')}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Add an item</h3>
        <div className="grid2">
          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="MVMNT Club Tee" />
          </div>
          <div className="field">
            <label htmlFor="p-price">Price (EGP)</label>
            <input
              id="p-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="450"
            />
          </div>
          <div className="field">
            <label htmlFor="p-stock">Stock</label>
            <input
              id="p-stock"
              inputMode="numeric"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              placeholder="Leave blank if made to order"
            />
            <div className="hint">
              Blank is not the same as zero — blank means unlimited, zero means sold out.
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-sizes">Sizes</label>
            <input
              id="p-sizes"
              value={sizes}
              onChange={(e) => setSizes(e.target.value)}
              placeholder="S, M, L, XL — blank if not apparel"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-image">Photo</label>
          <input
            id="p-image"
            type="file"
            accept="image/*"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            style={{ padding: 6 }}
          />
          <div className="hint">
            The picture members see in the shop. Square-ish looks best; you can change it later
            from the table above.
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-desc">Description</label>
          <textarea
            id="p-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A line or two members will read before buying."
          />
        </div>
        <button className="primary" onClick={addProduct} disabled={busy}>
          Add item
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          New items start as “coming soon” so you can get the details right before anyone can order.
        </div>
      </div>
    </>
  );
}
