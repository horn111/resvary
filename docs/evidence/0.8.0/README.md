# Resvary 0.8.0 Testnet evidence

The release proof runners write sanitized Arc and Circle Gateway Testnet records into this
directory. Both proofs must show:

- one non-expiring general credit lot for the verified funding transaction;
- replay returning the original grant without changing the balance or grant count;
- a mixed graduated/package price version;
- reserve, commit, release, receipt breakdown, and zero reserved balance after commit.

The records may contain public Testnet addresses, transaction hashes, nonces, proof IDs, and
facilitator references. They must not contain private keys, admin tokens, complete payment
signatures, environment files, or application customer data.
