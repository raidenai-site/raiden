from dodopayments import DodoPayments
import os

try:
    client = DodoPayments(bearer_token='test')
    attrs = [m for m in dir(client) if not m.startswith('_')]
    with open('dodo_info.txt', 'w') as f:
        f.write(f"Attributes: {attrs}\n")
        
    import inspect
    sig = inspect.signature(client.customers.customer_portal.create)
    with open('dodo_info.txt', 'a') as f:
        f.write(f"\nCreate Signature: {sig}\n")
        f.write(f"Parameters: {list(sig.parameters.keys())}\n")

except Exception as e:
    with open('dodo_info.txt', 'w') as f:
        f.write(str(e))
