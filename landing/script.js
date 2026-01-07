// Smooth scroll and navbar effects
document.addEventListener('DOMContentLoaded', () => {
    // Navbar background on scroll
    const nav = document.querySelector('.nav');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            nav.style.background = 'rgba(10, 10, 10, 0.95)';
        } else {
            nav.style.background = 'rgba(10, 10, 10, 0.8)';
        }
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Apply to animatable elements
    document.querySelectorAll('.feature-card, .step, .pricing-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // --- AI Assistant Demo Logic ---
    const assistantData = {
        tazim: {
            title: "Conflict Resolution",
            messages: `
                <div class="asst-msg asst-msg-user">
                    <p>What should I do about the situation with Tazim?</p>
                </div>
                <div class="asst-msg asst-msg-ai">
                    <p>Scanning recent context... 🔍<br><br>
                        It seems Tazim is feeling down. He went silent in the group chat immediately after Muaad made that comment about his work ethic.<br><br>
                        <strong>Advice:</strong> He might have taken Muaad's joke personally. Reach out to him privately—he likely feels undervalued right now.
                    </p>
                </div>
            `
        },
        radar: {
            title: "Relationship Radar",
            messages: `
                <div class="asst-msg asst-msg-user">
                    <p>Read the vibes between me and Jess. Is she into me?</p>
                </div>
                <div class="asst-msg asst-msg-ai">
                    <p>Scanning last 500 messages... 🔍<br><br>
                        <strong>Conclusion: Very Likely.</strong><br>
                        She replies in avg. 2 mins (vs your 15 mins), uses "😊" and "💀" frequently, and double-texts often. She also initiated the "hang out" idea twice.
                    </p>
                </div>
            `
        },
        gift: {
            title: "Gift Ideas",
            messages: `
                <div class="asst-msg asst-msg-user">
                    <p>What should I get Mike for his birthday? He's hard to shop for.</p>
                </div>
                <div class="asst-msg asst-msg-ai">
                    <p>Scanning chat with @mike_j... 🔍<br><br>
                        <strong>Ideas found in context:</strong><br>
                        1. Shared a link to a <strong>Keychron keyboard</strong> last month.<br>
                        2. Complained about his <strong>headphones</strong> breaking (Tuesday).<br>
                        3. Mentioned getting into <strong>coffee brewing</strong>.<br><br>
                        <strong>Recommendation:</strong> The headphones seem urgent, but the keyboard was a specific wish.
                    </p>
                </div>
            `
        }
    };

    const sidebarItems = document.querySelectorAll('.assistant-conv');
    const title = document.getElementById('asst-title');
    const messages = document.getElementById('asst-messages');

    if (sidebarItems && title && messages) {
        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                // Update Active State
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Update Content
                const key = item.getAttribute('data-chat');
                const data = assistantData[key];

                if (data) {
                    // Fade out
                    messages.style.opacity = '0';
                    title.style.opacity = '0';
                    setTimeout(() => {
                        title.innerText = data.title;
                        messages.innerHTML = data.messages;
                        // Fade in
                        messages.style.opacity = '1';
                        title.style.opacity = '1';
                    }, 200);
                }
            });
        });
    }
});
