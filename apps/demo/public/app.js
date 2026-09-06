const items = document.querySelector('#items');
const cartCount = document.querySelector('#cart-count');
const status = document.querySelector('#status');
const toastRoot = document.querySelector('#toast-root');
const modal = document.querySelector('#modal');
let count = 0;

document.querySelector('#add-item').addEventListener('click', async () => {
  status.textContent = 'Loading item...';
  document.body.classList.add('loading');
  await delay(50);
  const name = document.querySelector('#item-name').value || `Item ${count + 1}`;
  const li = document.createElement('li');
  li.className = 'cart-item';
  li.dataset.id = String(count + 1);
  li.textContent = name;
  items.append(li);
  count += 1;
  cartCount.textContent = String(count);
  status.textContent = `Added ${name}`;
  showToast(`Added ${name}`);
  document.body.classList.remove('loading');
});

document.querySelector('#open-modal').addEventListener('click', () => {
  modal.showModal();
});

document.querySelector('#close-modal').addEventListener('click', () => {
  modal.close();
});

document.querySelector('#toggle-loading').addEventListener('click', async () => {
  document.body.classList.add('loading');
  status.textContent = 'Working...';
  await delay(75);
  status.textContent = 'Done';
  document.body.classList.remove('loading');
});

document.querySelector('#item-name').addEventListener('input', (event) => {
  status.textContent = `Typing ${(event.target.value || '').length} chars`;
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRoot.append(toast);
  setTimeout(() => toast.remove(), 200);
}
