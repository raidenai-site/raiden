// --- Landing Page Auth & Payment Logic ---
const SUPABASE_URL = 'https://hdlhfxiergiaujruaixi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkbGhmeGllcmdpYXVqcnVhaXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxMDkyODUsImV4cCI6MjA4MTY4NTI4NX0.Hnx-z_PaX_ILIKJrRcnxmfGSznhzOPA-FNt6rnW3TBE';

let supabaseClient = null;
let currentUser = null;
let currentTier = 'free';

// ===== UI Helpers =====
const showModal = () => {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const content = modal.querySelector('.modal-content');
        if (content) content.style.transform = 'scale(1)';
    });
};

const closeModal = () => {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    modal.style.opacity = '0';
    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95)';
    setTimeout(() => modal.style.display = 'none', 300);
};

const toggleDropdown = () => {
    const dropdown = document.getElementById('user-dropdown');
    if (!dropdown) return;
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
};

// ===== Checkout / Portal =====
const createCheckout = async () => {
    try {
        if (!supabaseClient) throw new Error("Not initialized");

        const { data, error } = await supabaseClient.functions.invoke('create-checkout', {
            body: { return_url: window.location.href }
        });

        if (error) throw new Error(error.message || "Server error");
        if (data && data.url) {
            window.location.href = data.url;
        } else {
            throw new Error("Payment details missing.");
        }
    } catch (err) {
        console.error("Checkout failed:", err);
        alert('Failed to create checkout: ' + err.message);
    }
};

const openManagePortal = async () => {
    try {
        if (!supabaseClient) throw new Error("Not initialized");

        // Call the backend to get portal URL
        const { data, error } = await supabaseClient.functions.invoke('create-portal', {
            body: {}
        });

        if (error) throw new Error(error.message || "Server error");
        if (data && data.url) {
            window.location.href = data.url;
        } else {
            throw new Error("Portal details missing.");
        }
    } catch (err) {
        console.error("Portal failed:", err);
        alert('Failed to open portal: ' + err.message);
    }
};

// ===== Fetch User Tier =====
const fetchUserTier = async (userId) => {
    try {
        const { data, error } = await supabaseClient
            .from('users')
            .select('tier')
            .eq('id', userId)
            .single();

        if (error) {
            console.log('[Auth] Could not fetch tier:', error.message);
            return 'free';
        }
        return data?.tier || 'free';
    } catch (err) {
        console.error('[Auth] Tier fetch error:', err);
        return 'free';
    }
};

// ===== Update User Dropdown =====
const updateUserMenu = async () => {
    const dropdown = document.getElementById('user-dropdown');
    const userBtn = document.getElementById('user-btn');
    if (!dropdown || !userBtn) return;

    if (!supabaseClient) {
        console.error('[Auth] Client not ready');
        return;
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (session) {
            currentUser = session.user;
            currentTier = await fetchUserTier(session.user.id);

            // Update button style for logged-in state
            userBtn.style.borderColor = currentTier === 'paid' ? '#8b5cf6' : '#10b981';
            userBtn.querySelector('svg').setAttribute('stroke', currentTier === 'paid' ? '#a78bfa' : '#34d399');

            const tierLabel = currentTier === 'paid' ? '⚡ Pro' : '🆓 Free';
            const actionBtn = currentTier === 'paid'
                ? '<button id="dropdown-manage" style="width:100%;padding:10px 16px;background:linear-gradient(135deg,#8b5cf6,#ec4899);border:none;border-radius:8px;color:white;font-size:13px;cursor:pointer;margin-top:8px;">Manage Subscription</button>'
                : '<button id="dropdown-upgrade" style="width:100%;padding:10px 16px;background:linear-gradient(135deg,#2563eb,#8b5cf6);border:none;border-radius:8px;color:white;font-size:13px;cursor:pointer;margin-top:8px;">Upgrade to Pro</button>';

            dropdown.innerHTML = `
                <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="font-size:13px;color:#fff;margin-bottom:4px;">${currentUser.email}</div>
                    <div style="font-size:11px;color:#888;">${tierLabel}</div>
                </div>
                <div style="padding:8px 16px;">
                    ${actionBtn}
                    <button id="dropdown-logout" style="width:100%;padding:8px 16px;background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#888;font-size:13px;cursor:pointer;margin-top:8px;">Sign Out</button>
                </div>
            `;

            // Bind dropdown buttons
            const manageBtn = document.getElementById('dropdown-manage');
            const upgradeBtn = document.getElementById('dropdown-upgrade');
            const logoutBtn = document.getElementById('dropdown-logout');

            if (manageBtn) manageBtn.onclick = openManagePortal;
            if (upgradeBtn) upgradeBtn.onclick = createCheckout;
            if (logoutBtn) logoutBtn.onclick = async () => {
                await supabaseClient.auth.signOut();
                window.location.reload();
            };

            // Update pricing button
            updatePricingButton();

        } else {
            currentUser = null;
            currentTier = 'free';
            userBtn.style.borderColor = 'rgba(255,255,255,0.2)';
            userBtn.querySelector('svg').setAttribute('stroke', '#888');

            dropdown.innerHTML = `
                <div style="padding:12px 16px;">
                    <button id="dropdown-login" style="width:100%;padding:10px 16px;background:linear-gradient(135deg,#2563eb,#8b5cf6);border:none;border-radius:8px;color:white;font-size:13px;cursor:pointer;">Login / Sign Up</button>
                </div>
            `;

            document.getElementById('dropdown-login').onclick = () => {
                toggleDropdown();
                showModal();
            };
        }
    } catch (err) {
        console.error('[Auth] Error updating menu:', err);
    }
};

// ===== Update Pricing Button =====
const updatePricingButton = () => {
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (!upgradeBtn) return;

    if (currentUser && currentTier === 'paid') {
        upgradeBtn.innerText = 'Manage Subscription';
        upgradeBtn.onclick = (e) => {
            e.preventDefault();
            openManagePortal();
        };
    } else if (currentUser) {
        upgradeBtn.innerText = 'Upgrade to Pro';
        upgradeBtn.onclick = (e) => {
            e.preventDefault();
            createCheckout();
        };
    } else {
        upgradeBtn.innerText = 'Upgrade to Pro';
        upgradeBtn.onclick = (e) => {
            e.preventDefault();
            showModal();
        };
    }
};

// ===== Initialize =====
const init = () => {
    console.log('[Auth] Initializing...');

    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Auth] Supabase client created');
    } else {
        console.error('[Auth] Supabase not loaded!');
        return;
    }

    // User button toggle
    const userBtn = document.getElementById('user-btn');
    if (userBtn) {
        userBtn.onclick = toggleDropdown;
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('user-menu');
        const dropdown = document.getElementById('user-dropdown');
        if (menu && dropdown && !menu.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    // Update user menu
    updateUserMenu();

    // Login Modal
    const closeBtn = document.getElementById('close-modal');
    const modal = document.getElementById('login-modal');
    const loginForm = document.getElementById('login-form');

    if (closeBtn) closeBtn.onclick = closeModal;
    if (modal) modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const submitBtn = document.getElementById('login-submit-btn');
            const errDiv = document.getElementById('login-error');
            const msgDiv = document.getElementById('login-message');

            if (submitBtn) submitBtn.innerText = 'Processing...';
            if (errDiv) errDiv.style.display = 'none';
            if (msgDiv) msgDiv.style.display = 'none';

            // Try login first
            let { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

            if (error) {
                // Try signup
                const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({ email, password });

                if (signUpError) {
                    if (errDiv) {
                        errDiv.innerText = error.message;
                        errDiv.style.display = 'block';
                    }
                    if (submitBtn) submitBtn.innerText = 'Continue';
                    return;
                }

                if (signUpData.session) {
                    // Logged in after signup
                    closeModal();
                    updateUserMenu();
                    return;
                } else if (signUpData.user) {
                    // Email confirmation required
                    if (msgDiv) {
                        msgDiv.innerText = "Check your email to confirm your account!";
                        msgDiv.style.display = 'block';
                    }
                    if (submitBtn) submitBtn.innerText = 'Check Email';
                    return;
                }
            }

            if (data && data.session) {
                // Login successful
                closeModal();
                updateUserMenu();
            }
        };
    }
};

// Run init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
