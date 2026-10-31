---
layout: page
title: "Regenerative Neural Cellular Automaton"
quote: ""
render_with_liquid: false
reference_key: "archive-neural-cellular-automaton"
references: []
quote_reference: ""
quote_locator: ""
notes: []
permalink: "/archive/neural-cellular-automaton/"
---

<p>I was amazed by how much this seemed like biology. It helped me understand that we can find local rules that produce a specific behaviour we want.</p>

<p>I reproduced the method from <a href="https://distill.pub/2020/growing-ca/">Growing Neural Cellular Automata</a> on a repurposed old laptop, choosing the laughing-with-tears emoji as my target. Each cell stores 16 values: colour, opacity and twelve other values whose roles are learned. The same small neural network updates every cell using information from its immediate neighbourhood. Training compares the whole pattern with the target image, but when the trained model runs, the individual cells do not see that target.</p>

<p>I kept the paper's image-matching loss. To teach regeneration, the training repeatedly damages partially grown patterns and asks them to return to the intact target. I set up PyTorch training with saved checkpoints, resumable runs and progress logging so that the laptop could keep training over several days.</p>

<p>In my early experiments, regeneration sometimes produced "floaters" that caused too much growth. It reminded me of cancer. Short training runs on my old laptop were not enough. Later training improved the saved growth and repair tests, but I have not established that it eliminates this behaviour.</p>

<p>Try damaging the pattern in the <a href="https://sjaakiechen.github.io/personal-blog/assets/evidence/demos/joy-checkpoint-5850-live/index.html?load=auto">regeneration demo</a>: click or drag across the live grid to erase cells, then watch how it responds. Double-click to add a seed, or use Reset to start again. The demo runs the learned local rules; it does not train the network in your browser.</p>
