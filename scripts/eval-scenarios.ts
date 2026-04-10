/**
 * Test scenarios for evaluating ScaleDown compression quality.
 *
 * Each scenario simulates a multi-turn conversation that grows in context size.
 * This tests how well ScaleDown compresses at different context lengths
 * and whether compressed context produces equivalent LLM responses.
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface EvalScenario {
  name: string;
  description: string;
  messages: Message[];
}

export const scenarios: EvalScenario[] = [
  {
    name: "Short Q&A",
    description: "Simple factual questions — minimal context to compress",
    messages: [
      { role: "system", content: "You are a helpful voice AI assistant. Keep responses concise." },
      { role: "user", content: "What is the capital of France?" },
      { role: "assistant", content: "The capital of France is Paris." },
      { role: "user", content: "What about Germany?" },
      { role: "assistant", content: "The capital of Germany is Berlin." },
      { role: "user", content: "And what about Japan?" },
    ],
  },

  {
    name: "Growing context",
    description: "10-turn conversation where context grows linearly — tests compression at scale",
    messages: [
      { role: "system", content: "You are a helpful voice AI assistant. Keep responses concise and conversational." },
      { role: "user", content: "Can you explain how solar panels work?" },
      { role: "assistant", content: "Solar panels work by converting sunlight into electricity using photovoltaic cells. When photons from sunlight hit the silicon cells, they knock electrons loose, creating an electric current. This direct current is then converted to alternating current by an inverter for home use." },
      { role: "user", content: "What's the efficiency like these days?" },
      { role: "assistant", content: "Modern residential solar panels typically achieve 20-22% efficiency, meaning they convert about a fifth of the sunlight hitting them into electricity. Premium panels from companies like SunPower can reach 22-23%. Lab research has achieved over 47% with multi-junction cells, but these aren't commercially available yet." },
      { role: "user", content: "How long do they last?" },
      { role: "assistant", content: "Most solar panels come with 25-30 year warranties and can last even longer. They degrade about 0.5-0.8% per year, so after 25 years they're still producing about 80-85% of their original output. The inverter usually needs replacement after 10-15 years." },
      { role: "user", content: "What about the cost? Is it worth installing them?" },
      { role: "assistant", content: "The average cost of a residential solar system in the US is around $20,000-$25,000 before incentives. The federal Investment Tax Credit covers 30% of the cost. Most homeowners see payback in 7-12 years depending on their location, electricity rates, and sun exposure. After that, it's essentially free electricity for another 15-20 years." },
      { role: "user", content: "Can they work in cloudy areas?" },
      { role: "assistant", content: "Yes! Solar panels still work on cloudy days, just at reduced efficiency — typically producing 10-25% of their rated output. Germany, which is quite cloudy, is one of the world's top solar producers. The key is annual average sun hours, not just sunny days. Even in cloudy areas like the Pacific Northwest, solar can be worthwhile." },
      { role: "user", content: "What about storing excess energy? Do I need batteries?" },
      { role: "assistant", content: "You have a few options. Net metering lets you send excess power to the grid and get credits on your bill — this is the most cost-effective option where available. Battery storage like Tesla Powerwall costs $10,000-$15,000 but gives you backup power during outages and lets you use solar power at night. Many homeowners start without batteries and add them later." },
      { role: "user", content: "Given everything we've discussed, what's your recommendation for someone in a moderately sunny area with a $30,000 budget?" },
    ],
  },

  {
    name: "Technical discussion",
    description: "Code and technical content — tests if compression preserves technical accuracy",
    messages: [
      { role: "system", content: "You are a helpful programming assistant. Be precise and technical." },
      { role: "user", content: "How do I implement a binary search in Python?" },
      { role: "assistant", content: "Here's a binary search implementation:\n\ndef binary_search(arr, target):\n    left, right = 0, len(arr) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1\n\nTime complexity is O(log n), space is O(1)." },
      { role: "user", content: "How would I modify it to find the first occurrence of a duplicate value?" },
      { role: "assistant", content: "To find the first occurrence, modify the equality check to continue searching left:\n\ndef first_occurrence(arr, target):\n    left, right = 0, len(arr) - 1\n    result = -1\n    while left <= right:\n        mid = (left + right) // 2\n        if arr[mid] == target:\n            result = mid\n            right = mid - 1  # Keep searching left\n        elif arr[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return result\n\nThis still runs in O(log n) but finds the leftmost match." },
      { role: "user", content: "Now can you write a recursive version and explain the trade-offs?" },
    ],
  },

  {
    name: "Repetitive content",
    description: "Conversation with repeated themes — compression should excel here",
    messages: [
      { role: "system", content: "You are a helpful assistant for planning a weekly meal schedule." },
      { role: "user", content: "I need help planning meals for the week. I'm vegetarian." },
      { role: "assistant", content: "I'd be happy to help! For Monday, how about a chickpea curry with rice? It's hearty and full of protein. For Tuesday, we could do a Mediterranean quinoa bowl with roasted vegetables, feta, and a lemon tahini dressing." },
      { role: "user", content: "Those sound good. What about Wednesday and Thursday?" },
      { role: "assistant", content: "For Wednesday, I suggest a black bean and sweet potato enchilada bake — it's easy to prep and makes great leftovers. Thursday could be a Thai peanut stir-fry with tofu and vegetables served over jasmine rice." },
      { role: "user", content: "Perfect. And Friday through Sunday?" },
      { role: "assistant", content: "Friday: homemade margherita pizza with a side salad. Saturday: a hearty lentil and vegetable soup with crusty bread — great for batch cooking. Sunday: a special mushroom risotto with asparagus and parmesan." },
      { role: "user", content: "Can you give me a shopping list for the whole week based on everything we planned?" },
    ],
  },

  {
    name: "Factual accuracy test",
    description: "Questions requiring precise facts — tests if compression causes hallucination",
    messages: [
      { role: "system", content: "You are a knowledgeable assistant. Provide accurate, factual information." },
      { role: "user", content: "When was the Declaration of Independence signed?" },
      { role: "assistant", content: "The Declaration of Independence was adopted by the Continental Congress on July 4, 1776. However, most delegates actually signed it on August 2, 1776. The document was primarily authored by Thomas Jefferson, with edits from Benjamin Franklin and John Adams." },
      { role: "user", content: "How many original colonies were there and can you name them?" },
      { role: "assistant", content: "There were 13 original colonies: Virginia, Massachusetts, New Hampshire, Maryland, Connecticut, Rhode Island, Delaware, North Carolina, South Carolina, New York, New Jersey, Pennsylvania, and Georgia. Virginia was the first permanent English settlement (Jamestown, 1607), and Georgia was the last colony established (1733)." },
      { role: "user", content: "What were the main causes of the American Revolution?" },
      { role: "assistant", content: "The main causes included: taxation without representation (Stamp Act, Tea Act), British military presence (Quartering Act), restriction of colonial self-governance, economic restrictions through trade regulations (Navigation Acts), and Enlightenment ideas about natural rights and government by consent. The Boston Massacre (1770) and Boston Tea Party (1773) were key escalation points." },
      { role: "user", content: "Based on our entire conversation about American history, what was the most significant factor that led to independence?" },
    ],
  },
];
