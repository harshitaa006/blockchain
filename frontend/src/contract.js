export const escrowAbi = [
  "function createEscrow(bytes32 escrowId,string shipmentId,address payable seller) payable",
  "function release(bytes32 escrowId,bytes32 schemaVersion,bytes32 attestationId,bytes32 evidenceHash,bytes32 sourceId,uint64 issuedAt,uint64 expiresAt,bytes32 nonce,uint8 outcome,bytes signature) returns (bool)",
  "function escrows(bytes32) view returns (address buyer,address seller,uint256 amount,string shipmentId,bool released)",
  "event EscrowCreated(bytes32 indexed escrowId,address indexed buyer,address indexed seller,uint256 amount,string shipmentId)",
  "event EscrowReleased(bytes32 indexed escrowId,address indexed seller,uint256 amount)",
  "event AttestationRejected(bytes32 indexed escrowId,uint8 reasonCode)"
];
